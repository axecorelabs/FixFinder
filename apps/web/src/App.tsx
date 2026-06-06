export function App() {
  return (
    <main className="page">
      <section className="card">
        <h1>FixFinder Website</h1>
        <p className="muted">AI-powered artisan dispatch for homes. Text your issue, get matched fast.</p>
        <div className="heroPoints">
          <article>
            <h2>1. Report in Telegram</h2>
            <p>Send text and images of HVAC, plumbing, or electrical issues to the customer bot.</p>
          </article>
          <article>
            <h2>2. AI Triage</h2>
            <p>Gemini via OpenRouter classifies urgency, required skill, and summary for dispatch.</p>
          </article>
          <article>
            <h2>3. Smart Matching</h2>
            <p>FixFinder ranks available artisans and dispatches job offers in seconds.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
