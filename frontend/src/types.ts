export type FileChange = {
  path: string;
  code: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
};
export type Repo = {
  name: string;
  path: string;
  branch: string;
  branches: string[];
  files: FileChange[];
  remotes: string;
  remoteNames: string[];
  upstream: string;
  counts: string;
  fingerprint: string;
  merging: boolean;
  rebasing: boolean;
  identity: { name: string; email: string };
};
