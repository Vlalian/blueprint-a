// A branch's preview name (ticket 55): the namespace (namespace mode) or Helm release (helm mode)
// it gets. Kubernetes names a namespace with a DNS label: at most 63 lowercase letters, digits and
// dashes, starting and ending with a letter or digit; Helm caps a release name at 53. A short hash
// of the exact branch name ends every name, so two branches that read alike once lowercased and
// dashed (ticket/55, ticket-55) never share a preview, and cleanup never reaches the other one.

import { createHash } from 'node:crypto';

const HASH = 6;

/** The branch lowercased, every run of other characters one dash, no dash at either end. */
const slug = (branch: string) => branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const hashOf = (branch: string) => createHash('sha256').update(branch).digest('hex').slice(0, HASH);

/** prefix + the branch as a DNS label + '-' + a hash of the branch, cut to fit max. */
export function previewName(prefix: string, branch: string, max: number): string {
  const room = max - prefix.length - HASH - 1;
  const part = slug(branch).slice(0, room).replace(/-$/, '');
  return `${prefix}${part === '' ? '' : `${part}-`}${hashOf(branch)}`;
}
