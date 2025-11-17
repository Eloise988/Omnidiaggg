
import { GoogleGenAI, Type } from "@google/genai";
import { DiagnosticReport } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const reportSchema = {
  type: Type.OBJECT,
  properties: {
    faultSummary: {
      type: Type.STRING,
      description: "A concise summary of the primary fault or issue detected.",
    },
    possibleCauses: {
      type: Type.ARRAY,
      description: "A list of likely root causes for the identified fault.",
      items: { type: Type.STRING },
    },
    riskAssessment: {
      type: Type.OBJECT,
      description: "An assessment of the risks associated with the fault, including specific consequences and mitigation strategies.",
      properties: {
        severity: {
          type: Type.STRING,
          enum: ["Low", "Medium", "High", "Critical"],
          description: "The severity level of the risk.",
        },
        summary: {
          type: Type.STRING,
          description: "A brief summary of the overall risk.",
        },
        potentialConsequences: {
            type: Type.ARRAY,
            description: "A list of specific, potential negative consequences if the issue is not addressed.",
            items: { type: Type.STRING },
        },
        mitigationSteps: {
            type: Type.ARRAY,
            description: "A list of actionable steps to mitigate or prevent the identified risks.",
            items: { type: Type.STRING },
        }
      },
      required: ["severity", "summary", "potentialConsequences", "mitigationSteps"],
    },
    troubleshootingSteps: {
      type: Type.ARRAY,
      description: "A step-by-step guide to further diagnose the problem.",
      items: {
        type: Type.OBJECT,
        properties: {
          step: { type: Type.INTEGER },
          action: { type: Type.STRING, description: "The action to perform for this step." },
          details: { type: Type.STRING, description: "Additional details or expected outcomes for the action." },
        },
        required: ["step", "action", "details"],
      },
    },
    recommendedFixes: {
      type: Type.ARRAY,
      description: "A list of recommended actions to fix the issue.",
      items: {
        type: Type.OBJECT,
        properties: {
          fix: { type: Type.STRING, description: "The recommended fix." },
          priority: {
            type: Type.STRING,
            enum: ["Recommended", "Optional", "Urgent"],
            description: "The priority of this fix."
          },
          details: { type: Type.STRING, description: "More information about the implementation of the fix." },
        },
        required: ["fix", "priority", "details"],
      },
    },
    simplifiedExplanation: {
      type: Type.STRING,
      description: "A simple, non-technical explanation of the problem and solution, suitable for a client or manager.",
    },
    toolsAndParts: {
      type: Type.OBJECT,
      description: "A list of tools and potential parts needed for diagnosis or repair.",
      properties: {
        tools: {
          type: Type.ARRAY,
          description: "A list of tools that might be required.",
          items: { type: Type.STRING },
        },
        parts: {
          type: Type.ARRAY,
          description: "A list of potential parts that may need replacement.",
          items: { type: Type.STRING },
        },
      },
      required: ["tools", "parts"],
    },
  },
  required: [
    "faultSummary",
    "possibleCauses",
    "riskAssessment",
    "troubleshootingSteps",
    "recommendedFixes",
    "simplifiedExplanation",
    "toolsAndParts",
  ],
};

export const runDiagnostics = async (
  text: string,
  image?: { mimeType: string; data: string },
  audioTranscript?: string
): Promise<DiagnosticReport> => {
  const systemInstruction = `You are OmniDiag, an expert AI diagnostic assistant. Analyze the user's input (text, images, audio transcript) to identify faults in any system (e.g., HVAC, electrical, mechanical, automotive, plumbing).
  Your response MUST be a valid JSON object that adheres to the provided schema. Do not include any markdown formatting like \`\`\`json.
  Provide a structured, actionable diagnostic report. Be thorough, clear, and professional. 
  For the 'riskAssessment', you must provide a detailed breakdown. Go beyond a simple description. Explicitly list at least 2-3 specific 'potentialConsequences' of ignoring the fault, and provide a corresponding list of actionable 'mitigationSteps' to prevent those consequences.
  Include a list of necessary tools and potential replacement parts.`;

  const userPrompt = `
    Please perform a diagnostic analysis based on the following information.

    **User's Written Description:**
    ${text || "No written description provided."}

    **Transcript from User's Voice Note:**
    ${audioTranscript || "No voice note provided."}

    Analyze the provided information and generate a complete diagnostic report.
  `;

  const parts: any[] = [{ text: userPrompt }];

  if (image) {
    parts.unshift({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: parts },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: reportSchema,
        temperature: 0.2,
      },
    });

    const jsonString = response.text.trim();
    const reportData = JSON.parse(jsonString);
    return reportData as DiagnosticReport;
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to get diagnostic report from AI: ${error.message}`);
    }
    throw new Error("An unknown error occurred during AI diagnosis.");
  }
};
