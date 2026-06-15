import { randomUUID, timingSafeEqual } from "node:crypto";

export class AuthStore {
  private sessions = new Set<string>();
  constructor(private password: string) {}

  login(attempt: string): string | null {
    const a = Buffer.from(attempt);
    const b = Buffer.from(this.password);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const sid = randomUUID();
    this.sessions.add(sid);
    return sid;
  }

  valid(sid: string | undefined): boolean { return !!sid && this.sessions.has(sid); }
  logout(sid: string) { this.sessions.delete(sid); }
}
