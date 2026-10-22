// @process-shell
// node flow/cli.ts <status|done|in-flight|gate-queue|build|review|merge|pr|watch-pr|ledger> [args]
// The flow tools in the repo this runs in (ticket 84). Wiring only: main.ts picks the tool and
// reads config/flow.json, flow-io.ts is the real I/O.

import { flowIo } from './flow-io.ts';
import { runFlow } from './main.ts';

process.exitCode = runFlow(process.argv.slice(2), flowIo(process.cwd()));
