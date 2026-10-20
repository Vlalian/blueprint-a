import { describe, expect, it } from 'vitest';
import { previewName } from './names.ts';

const LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

describe('previewName', () => {
  it('is the prefix, the branch made a DNS label, and a short hash of the exact branch', () => {
    const name = previewName('preview-', 'ticket/55-Kubernetes_Previews', 63);
    expect(name).toMatch(/^preview-ticket-55-kubernetes-previews-[0-9a-f]{6}$/);
    expect(name).toMatch(LABEL);
  });

  it('is the same for the same branch, and differs for branches that read alike', () => {
    expect(previewName('p-', 'ticket/55', 63)).toBe(previewName('p-', 'ticket/55', 63));
    expect(previewName('p-', 'ticket/55', 63)).not.toBe(previewName('p-', 'ticket-55', 63));
  });

  it('collapses runs of other characters to one dash and trims them at both ends', () => {
    expect(previewName('p-', '--a//b..c--', 63)).toMatch(/^p-a-b-c-[0-9a-f]{6}$/);
  });

  it('cuts the branch part so the name fits the limit, without a dash before the hash', () => {
    const long = `feature/${'x'.repeat(30)}-${'y'.repeat(60)}`;
    const ns = previewName('preview-', long, 63);
    expect(ns).toHaveLength(63);
    expect(ns).toMatch(LABEL);
    const release = previewName('preview-', `a/${'b'.repeat(35)}-zz`, 53);
    expect(release.length).toBeLessThanOrEqual(53);
    expect(release).toMatch(LABEL);
    expect(release).not.toMatch(/--/);
  });

  it('is the prefix and the hash for a branch with no letters or digits', () => {
    expect(previewName('p-', '///', 63)).toMatch(/^p-[0-9a-f]{6}$/);
  });
});
