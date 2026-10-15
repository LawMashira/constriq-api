export type AuthUser = {
  id: string;
  companyId: string;
  email: string;
  name: string;
  status: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
};
