# Recorded kubectl, Helm and Prometheus output

The environment adapter's tests (`adapters/environment/`) play these back through a fake runner.
No cluster was reachable or used where they were written: each file is written in the shape the
sources in `adapters/environment/README.md` give (kubectl's printed messages from its source, JSON
in the Kubernetes API's object shapes, Helm's `list -o json`, Prometheus' instant query reply).

| File | Is |
|---|---|
| `deployments.txt` | `kubectl get deployments -o name` with two Deployments |
| `no-resources.stderr.txt` | what kubectl prints on stderr when a namespace has none |
| `rollout-ready.txt` | `kubectl rollout status` that finished |
| `rollout-waiting.txt`, `rollout-stuck.stderr.txt` | a rollout past its progress deadline (exit 1) |
| `rollout-timeout.stderr.txt` | a rollout still waiting when `--timeout` ran out (exit 1) |
| `ingress-list.json` | one Ingress with a TLS host |
| `ingress-two.json` | two Ingresses; the second's first rule has no host and its TLS names another host |
| `ingress-none.json` | no Ingress |
| `namespace-own.json` | a preview namespace annotated with its branch |
| `namespace-other.json` | a namespace of the same name without the annotation |
| `namespace-delete.txt` | `kubectl delete namespace` |
| `helm-list.json`, `helm-list-none.json` | `helm list -o json` with the branch's release, and with none |
| `helm-uninstall.txt`, `helm-rollback.txt` | what Helm prints |
| `rollout-undo.txt` | `kubectl rollout undo` |
| `prometheus-errors.json` | two series summing to 42.5 |
| `prometheus-requests.json` | one series, 400 |
| `prometheus-empty.json` | no series (0) |
| `prometheus-bad-query.json`, `prometheus-nan.json` | a refused query, and a value that is not a number |
