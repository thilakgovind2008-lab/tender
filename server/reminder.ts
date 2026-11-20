export function reminderRequest(sessionId: string, revision: number, secret: string) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
    body: JSON.stringify({ job_id: sessionId, action: 'support_draft', expected_revision: revision }),
  };
}
