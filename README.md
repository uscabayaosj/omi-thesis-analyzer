# Omi Thesis Analyzer

AI-powered conversation analysis for PhD research on Pioneer Sovereignty. Pulls conversations from the Omi Developer API and runs 5-dimension analysis through GPT-4o.

## Setup

1. Copy `.env.example` to `.env.local`
2. Add your Omi Developer API key (from Omi app → Developer → API Keys)
3. Add your OpenAI API key
4. `npm run dev` or deploy to Vercel

## Analysis Dimensions

1. **Thesis Relevance** — How the conversation connects to "Pioneer Sovereignty" (sovereignty through ranch sociality in Montana)
2. **Derived Meanings** — Deeper patterns, social dynamics, power relations
3. **Summary** — Comprehensive overview of the conversation
4. **Forward Thinking** — Research directions, hypotheses, next steps
5. **Custom** (toggle) — User-defined analysis prompt for ad-hoc needs

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/uscabayaosj/omi-thesis-analyzer&env=OMI_API_KEY,OPENAI_API_KEY)

## Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS
- OpenAI GPT-4o
- Omi Developer API
- PWA (installable on mobile)
