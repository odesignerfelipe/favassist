import type { AIProvider, GenerateJsonRequest, GenerateTextRequest } from './types';

/**
 * Provedor roteirizado — EXCLUSIVO PARA TESTES AUTOMATIZADOS.
 * Devolve respostas pré-definidas para exercitar validação e fluxo sem chamar uma IA real.
 * Não é selecionável por variável de ambiente.
 */
export class ScriptedProvider implements AIProvider {
  readonly name = 'scripted-test';
  readonly model = 'scripted';
  readonly calls: { system: string; user: string }[] = [];
  constructor(private readonly responses: unknown[], private readonly textResponses: string[] = []) {}

  async generateJson<T>(req: GenerateJsonRequest<T>) {
    this.calls.push({ system: req.system, user: req.user });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return { data: next, model: this.model };
  }

  async generateText(req: GenerateTextRequest) {
    this.calls.push({ system: req.system, user: req.user });
    return { text: this.textResponses.shift() ?? 'ok', model: this.model };
  }
}
