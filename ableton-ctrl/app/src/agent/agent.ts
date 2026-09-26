/**
 * The agent — where a typed prompt will go once there is an API behind it.
 *
 * Kept as its own seam so the bar never has to change when the connection is
 * made: `askAgent` is the one call, and today it simply reports that nothing
 * is connected yet.
 */
export type AgentReply = { ok: true; text: string } | { ok: false; reason: 'not-connected' }

export async function askAgent(prompt: string): Promise<AgentReply> {
  void prompt
  return { ok: false, reason: 'not-connected' }
}
