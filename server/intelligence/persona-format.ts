import type { AudiencePersona } from '../../shared/types/workspace.js';

export function formatPersonasForPrompt(personas: AudiencePersona[] | null | undefined): string {
  if (!personas?.length) return '';

  // Keep this shape stable because schema, chat, and prompt callers share it.
  const personaStr = personas.map(p => {
    const parts = [`**${p.name}**${p.buyingStage ? ` (${p.buyingStage} stage)` : ''}: ${p.description}`];
    if (p.painPoints.length) parts.push(`  Pain points: ${p.painPoints.join('; ')}`);
    if (p.goals.length) parts.push(`  Goals: ${p.goals.join('; ')}`);
    if (p.objections.length) parts.push(`  Objections: ${p.objections.join('; ')}`);
    if (p.preferredContentFormat) parts.push(`  Prefers: ${p.preferredContentFormat}`);
    return parts.join('\n');
  }).join('\n\n');

  return `\n\nTARGET AUDIENCE PERSONAS (write to address these specific people — their pain points, goals, and objections):\n${personaStr}`;
}
