/**
 * Limite de tentativas de login com erro POR E-MAIL (complementa o limite por IP).
 * Impede testar senhas de uma conta trocando de IP. Em memória: a API roda em uma única
 * instância; com mais instâncias, mover para o Redis.
 */
export class LoginGuard {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private key(email: string) {
    return email.trim().toLowerCase();
  }

  /** Segundos até liberar, ou 0 se o e-mail pode tentar. */
  blockedFor(email: string): number {
    const entry = this.failures.get(this.key(email));
    if (!entry) return 0;
    const left = entry.resetAt - this.now();
    if (left <= 0) {
      this.failures.delete(this.key(email));
      return 0;
    }
    return entry.count >= this.maxFailures ? Math.ceil(left / 1000) : 0;
  }

  recordFailure(email: string) {
    const k = this.key(email);
    const t = this.now();
    const entry = this.failures.get(k);
    if (!entry || entry.resetAt <= t) this.failures.set(k, { count: 1, resetAt: t + this.windowMs });
    else entry.count++;
    if (this.failures.size > 10_000) this.prune();
  }

  recordSuccess(email: string) {
    this.failures.delete(this.key(email));
  }

  private prune() {
    const t = this.now();
    for (const [k, v] of this.failures) if (v.resetAt <= t) this.failures.delete(k);
  }
}
