export interface WorkspaceDescriptor {
  id: string;
  name: string;
  rootPath: string;
}

export interface WorkspaceError {
  code: string;
  message: string;
}
