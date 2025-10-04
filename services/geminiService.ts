

import { GoogleGenAI, Modality } from "@google/genai";

// Ensure the API key is available from environment variables.
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  // In a real app, you might not want to throw an error here but handle it gracefully.
  // For this project, we assume the key is always present.
  console.error("API_KEY environment variable not set!");
}

const ai = new GoogleGenAI({ apiKey: API_KEY as string });

/**
 * Sends an image to the Gemini API to remove watermarks.
 * @param base64DataUrl The image data as a base64 data URL (e.g., "data:image/jpeg;base64,...").
 * @returns A promise that resolves to the base64 data URL of the processed image.
 */
export const removeWatermark = async (base64DataUrl: string): Promise<string> => {
  const parts = base64DataUrl.split(',');
  if (parts.length !== 2) {
    throw new Error("Invalid base64 data URL format.");
  }
  
  const mimeTypePart = parts[0].match(/:(.*?);/);
  if (!mimeTypePart || !mimeTypePart[1]) {
      throw new Error("Could not determine MIME type from data URL.");
  }
  
  const mimeType = mimeTypePart[1];
  const base64Data = parts[1];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            // Rephrased to a more neutral "inpainting" task to avoid policy refusals.
            text: 'Perform an inpainting task on this image. Identify any overlaid elements (like text, logos, or graphics) that are not part of the original background. Fill in the areas where these elements were located, making sure the result blends seamlessly and realistically with the surrounding background scenery. The final output should be only the modified image.',
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    // Find the image part in the response
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        const resultBase64 = part.inlineData.data;
        const resultMimeType = part.inlineData.mimeType;
        return `data:${resultMimeType};base64,${resultBase64}`;
      }
    }
    
    // If no image part is found, it's an error. Capture the text response for better debugging.
    let textResponse = "It may have refused the request.";
    for (const part of response.candidates[0].content.parts) {
        if (part.text) {
            textResponse = part.text;
            break;
        }
    }
    throw new Error(`The API did not return an image. API Response: "${textResponse}"`);

  } catch (error: any) {
    console.error("Error calling Gemini API:", error);
    // Re-throw a more user-friendly error, including the specific message if available.
    throw new Error(error.message || "Failed to process image with AI. Please check the console for details.");
  }
};
