import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { prompt, context } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const fullPrompt = `
      You are an AI assistant helping a pastor write SMS messages for their congregation.
      Context: ${context || 'Church communication'}
      User Prompt: ${prompt}
      
      Requirements:
      1. Keep the message concise (suitable for SMS, ideally under 160 characters).
      2. Use a warm, encouraging, and pastoral tone.
      3. Use {name} or {first_name} as placeholders for personalization if appropriate.
      4. Output ONLY the message text.
    `;

    // Using the new @google/genai SDK pattern
    const response = await ai.models.generateContentStream({
      model: 'gemini-1.5-flash',
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
    });
    
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // In @google/genai, the response object itself is often the async iterable
          // or contains a stream property. Let's handle the iterable case.
          for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          controller.close();
        } catch (streamErr: any) {
          console.error('[AI Gen] Stream Error:', streamErr);
          controller.error(streamErr);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err: any) {
    console.error('[AI Gen] Error:', err);
    return NextResponse.json({ error: err.message || 'Error generating message' }, { status: 500 });
  }
}
