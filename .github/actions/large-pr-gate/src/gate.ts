import { approvalCandidates, type Review } from './approval.js';
import { generatedPathMatcher, reviewableLines, type ChangedFile } from './size.js';

export interface PullRequestFacts {
  authorId: number;
  headSha: string;
  additions: number;
  deletions: number;
}

export interface PullRequestSource {
  pull(): Promise<PullRequestFacts>;
  // Undefined when the pull request exceeds the GitHub file list limit.
  files(): Promise<ChangedFile[] | undefined>;
  gitattributes(): Promise<string>;
  reviews(): Promise<Review[]>;
  hasWriteAccess(login: string): Promise<boolean>;
}

export interface GateResult {
  decision: 'pass' | 'approved' | 'block';
  lines: number;
}

export async function evaluateGate(source: PullRequestSource, maxLines: number): Promise<GateResult> {
  const pull = await source.pull();
  const rawLines = pull.additions + pull.deletions;

  if (rawLines <= maxLines) {
    return { decision: 'pass', lines: rawLines };
  }

  const files = await source.files();
  const lines = files === undefined
    ? rawLines
    : reviewableLines(files, generatedPathMatcher(await source.gitattributes()));

  if (lines <= maxLines) {
    return { decision: 'pass', lines };
  }

  for (const login of approvalCandidates(await source.reviews(), pull.authorId, pull.headSha)) {
    if (await source.hasWriteAccess(login)) {
      return { decision: 'approved', lines };
    }
  }

  return { decision: 'block', lines };
}
