# Environment adapters

The preview, walk-the-app and incident steps read one interface (`environment.ts`), so the same
steps run wherever the work is deployed:

| Call | Gives | Kubernetes (`kubernetes.ts`, `kubectl` and optional Helm) |
|---|---|---|
| `previewUrl(branch)` | the branch's preview address | the host of the preview's Ingress, `https://` when the host is in its TLS hosts |
| `ready(branch)` | ready or not, and why | `kubectl rollout status` for each Deployment of the preview, all within `readyTimeoutSeconds` |
| `errorRate(release, window)` | 5xx and requests of a production release in a window | two Prometheus instant queries through the API server's service proxy (`kubectl get --raw`) |
| `rollback(release)` | what the rollback printed | `kubectl rollout undo deployment/<release>`, or `helm rollback <release>` in helm mode |
| `cleanup(branch)` | what was removed | the branch's own namespace, or its own Helm release, and nothing else |

`previewWhenReady(env, branch)` gives the address only once the preview is ready. Blueprint B (the
reference build) answers the same calls with a Vercel preview, a Neon database branch and a Vercel
rollback.

Every kubectl and Helm call goes through an injected runner (`Runner`: the tool, its arguments, a
finished process). The tests play back output in `fixtures/kubernetes/`; they never reach a
cluster. A harness wires the real runner (for example `spawnSync(tool, args)` with the kubeconfig
it is allowed to use) and a clock.

## The config

`config.ts` reads a project's `"preview"` block:

```json
{
  "preview": {
    "platform": "kubernetes",
    "mode": "namespace",
    "prefix": "preview-",
    "readyTimeoutSeconds": 300,
    "productionNamespace": "shop",
    "metrics": {
      "source": "prometheus",
      "namespace": "monitoring",
      "service": "prometheus-operated",
      "port": "9090",
      "errors": "sum(increase(http_requests_total{namespace=\"{namespace}\",app=\"{release}\",code=~\"5..\"}[{range}]))",
      "requests": "sum(increase(http_requests_total{namespace=\"{namespace}\",app=\"{release}\"}[{range}]))"
    },
    "rollback": { "enabled": false }
  }
}
```

- `mode`: `namespace` (the default) gives each branch its own namespace; `helm` gives each branch
  a Helm release in the shared `namespace`, whose objects carry `instanceLabel` (default
  `app.kubernetes.io/instance`, the label Helm's chart conventions set) with the release name.
- A branch's name is `prefix`, the branch as a DNS label, and a 6-character hash of the exact
  branch (`names.ts`), cut to 63 characters for a namespace and 53 for a release. The hash keeps
  `ticket/55` and `ticket-55` apart.
- `ingress` names the Ingress to read when a preview has more than one; with several and none
  named, `previewUrl` refuses to guess.
- `metrics` is `{ "source": "none" }` by default: then `errorRate` throws, and the incident rule
  alerts that it cannot judge. In the queries, `{namespace}` is `productionNamespace`, `{release}`
  the release and `{range}` the window in seconds (`600s`).
- `protectedBranches` (default `main`, `master`, `dev`, `develop`) are never cleaned up.
- `rollback` is off unless `"enabled": true`. Its numbers default to Blueprint B's and can be
  tuned; `cooldownHours` can be longer than 24 but never shorter. Anything unknown or malformed in
  the block is an error naming the key.

## Cleanup removes only the branch's own preview

- **Namespace mode:** the namespace must carry the annotation `blueprint-a/branch` with the exact
  branch name, or cleanup refuses and leaves it. The pipeline that creates the preview sets it:
  `kubectl create namespace <name>` then
  `kubectl annotate namespace <name> blueprint-a/branch=<branch>`. A namespace already gone is
  nothing to remove (`--ignore-not-found`). The delete is `kubectl delete namespace <name>
  --wait=false`.
- **Helm mode:** `helm list -n <namespace> --all --filter '^<release>$' -o json` must list a
  release of exactly that name in exactly that namespace; then `helm uninstall <release> -n
  <namespace>`.

## The incident rule

`incident.ts` is Blueprint B's rule (its decision 5) on this interface. A production release
that went live at most `maxMinutesSinceLive` ago and has served at least `minMinutesOfTraffic` is
judged on its first `windowMinutes`: it regresses when it has at least `min5xxCount` 5xx, at least
`min5xxRatio` of its requests are 5xx, and its 5xx are at least
`max(baselineMultiplier x baseline, baseline + baselineMargin)`, the baseline being its 5xx over the
`baselineMinutes` before it went live (the previous revision's traffic), scaled to the window.

- Rollback off (the default): a regression is an alert only.
- Rollback on: one rollback runs; another within `cooldownHours` is refused and alerted. The
  caller keeps the rollback history and passes it back in.
- Metrics that cannot be read are an alert, never a rollback.

Blueprint B's interlocks that are Vercel's and Neon's (a target that is a rollback candidate, the
database not suspended) have no direct Kubernetes form: `kubectl rollout undo` and `helm
rollback` pick the previous revision themselves, and a database is whatever the company runs.

## Sources (spike, ticket 55)

| What | Source |
|---|---|
| Rollout status, its messages and exit code | [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) ("Failed Deployment", "Rolling Back a Deployment"); kubectl's `pkg/polymorphichelpers/rollout_status.go` |
| `kubectl rollout status` / `undo` | [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/), [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/) |
| Ingress hosts and TLS | [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) |
| Namespace names | [Object names: DNS label names](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/#dns-label-names) |
| The service proxy | [Access services running on clusters](https://kubernetes.io/docs/tasks/access-application-cluster/access-cluster-services/#manually-constructing-apiserver-proxy-urls) |
| Prometheus instant query | [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/#instant-queries) |
| Helm | [helm rollback](https://helm.sh/docs/helm/helm_rollback/), [helm uninstall](https://helm.sh/docs/helm/helm_uninstall/), [helm list](https://helm.sh/docs/helm/helm_list/) |

kubernetes.io was not reachable from where this was built; its pages were read from their source
in the kubernetes/website repository, Helm's from helm/helm-www, Prometheus' from its repository.

**Unverified** (no cluster was reachable or used; the first live check happens at work):

1. The text kubectl prints when `--timeout` runs out (`error: timed out waiting for the
   condition` in the versions read). The adapter does not depend on it: any non-zero exit is
   "not ready", with what kubectl said.
2. `helm list -o json`'s field names (`name`, `namespace`, `revision`, `status`, ...), taken from
   Helm's source, and Helm's 53-character cap on release names.
3. That the API server's service proxy reaches the company's Prometheus: the kubeconfig needs
   `get` on `services/proxy` in its namespace, and a Prometheus outside the cluster (or a managed
   one, like Azure Monitor managed Prometheus) needs its own client, not this proxy.
4. The metric names a cluster has: the app's own (`http_requests_total` is a convention, not a
   standard), ingress-nginx's `nginx_ingress_controller_requests`, Istio's
   `istio_requests_total`, Linkerd's `response_total`. The queries are config for this reason.
5. That `helm` objects carry `app.kubernetes.io/instance`: it is a chart convention, not
   something Helm enforces; `instanceLabel` changes it.
