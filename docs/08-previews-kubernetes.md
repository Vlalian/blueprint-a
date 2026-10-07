# Previews and incidents on Kubernetes

The reference build gives each ticket a preview deployment and a database branch, walks the
preview before review, and watches production during a run, with one automatic action allowed: a
rollback. It does that on a hosting platform with previews built in. This page maps the same rules
to Kubernetes, where previews, readiness, error rates and rollbacks are pieces you assemble.
`adapters/environment` holds the calls as code (see its README for every command, its source and
what is unverified); the choices that depend on your cluster are in
[06-open-questions.md](06-open-questions.md), section 7.

## The rules (unchanged)

1. **A preview per ticket.** Each ticket's branch gets its own running copy of the app, and only
   its own: nothing it does touches another ticket's preview or production.
2. **Walk the preview.** Before review, the app is walked on the preview's address: the ticket's
   acceptance criteria as a short recorded path through the app, judged by the app's own browser
   tests. A preview that is not ready is not walked; there is nothing to judge.
3. **Alert only, by default.** The incident watcher reads; it does not write. A regression is a
   notice to the human.
4. **At most one automatic rollback a day,** and only when the project config turns rollback on.
   Every rollback is logged and reported, and leaves a task for the human to ship the fix.
5. **Thresholds in config.** Every number below is a setting with a default, not code.
6. **Clean up after the ticket.** When the ticket is done or abandoned, its preview goes, and
   nothing else does.

## In Kubernetes terms

| Rule | Reference build | Kubernetes |
|---|---|---|
| Preview per ticket | a preview deployment per branch, built in | a **namespace per branch**, or a **Helm release per branch** in one shared previews namespace; the work pipeline deploys it |
| The preview's address | the platform gives a URL per deployment | the host of the preview's **Ingress** (https when the host has TLS), usually under a wildcard previews domain |
| Ready to walk | the deployment's state is ready | **`kubectl rollout status`** finishes for every Deployment of the preview within a timeout; a rollout past its progress deadline, or still waiting when the timeout runs out, is not ready |
| Test data | a database branch per run with a time-to-live | open: a database in the namespace seeded from fixtures, a shared test database, or a database operator's per-namespace copy |
| Error rate | the platform's request logs, 5xx per deployment | whatever metrics the cluster has: Prometheus scraping the app, the ingress controller or a service mesh; a managed Prometheus; or a vendor APM. The adapter reads Prometheus through the API server; the queries are config |
| Rollback | promote the previous deployment | **`kubectl rollout undo`** (the Deployment's previous ReplicaSet) or **`helm rollback`** (the release's previous revision) |
| Cleanup | the platform expires previews; the database branch's time-to-live | **`kubectl delete namespace`**, only for a namespace annotated with that exact branch, or **`helm uninstall`** of that exact release |

## The incident rule

The same rule as the reference build, on the error rate the cluster's metrics give:

- Judge a production release only in its first **30 minutes** after going live, and only once it
  has served **5 minutes** of traffic. Look at its first **10 minutes** (or less, if less has
  passed).
- It regresses when, in that window, it has **at least 10** 5xx responses, **at least 5%** of its
  requests are 5xx, and its 5xx count is at least **3 times, and at least 10 more than,** the
  baseline: its 5xx over the **60 minutes** before it went live (the previous revision's traffic),
  scaled to the window.
- **Rollback off** (the default): a regression is an alert.
- **Rollback on:** one rollback runs. Another within **24 hours** is refused, and alerted. The
  cooldown can be set longer, never shorter.
- Metrics that cannot be read, or no metrics configured, are an alert, never a rollback.

A failed build is an alert, never a rollback, as in the reference build. A stuck rollout is not
quite the same thing: during a rolling update some new pods may already serve traffic. It is an
alert too; only the error rate above can make a rollback candidate.

## Settings

All in the project's `"preview"` block, read by `adapters/environment/config.ts`:

| Setting | Default | Means |
|---|---|---|
| `mode` | `namespace` | `namespace` or `helm` |
| `prefix` | `preview-` | the start of every preview namespace or release name |
| `namespace` | (required in helm mode) | the shared previews namespace |
| `ingress` | the only one | which Ingress gives the address |
| `readyTimeoutSeconds` | 300 | how long a preview may take to be ready |
| `productionNamespace` | (required) | where the production releases run |
| `protectedBranches` | main, master, dev, develop | never cleaned up |
| `metrics` | none | Prometheus' service and the two queries (errors, requests) |
| `rollback.enabled` | false | whether the one automatic action is allowed |
| `rollback.*` | the numbers above | `maxMinutesSinceLive`, `minMinutesOfTraffic`, `windowMinutes`, `min5xxCount`, `min5xxRatio`, `baselineMinutes`, `baselineMultiplier`, `baselineMargin`, `cooldownHours` |

## What the agents may do

Reads are free: rollout status, Ingresses, metrics. Creating previews belongs to the work
pipeline, not to an agent. The two writes are narrow: deleting the ticket's own namespace or
release, and the one rollback when the config allows it. Give the harness a kubeconfig that can
do exactly that, and no more; whether such a kubeconfig is allowed at all is a question for work.
