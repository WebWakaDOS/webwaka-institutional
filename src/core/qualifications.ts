/**
 * JAMB & WAEC Result Verification — WebWaka Institutional Suite
 *
 * Invariant 1 (Nigeria-First, Africa-Ready):
 *   JAMB and WAEC APIs require institutional partnership agreements.
 *   When the API is unavailable (network error, 5xx, or missing credentials),
 *   the system FALLS BACK to manual document upload + admin review.
 *   The caller decides the mode — this module only executes and reports.
 */

// ─── JAMB ─────────────────────────────────────────────────────────────────────

export interface JambVerifyParams {
  regNumber: string;
  apiKey: string;
}

export interface JambVerifyResult {
  success: boolean;
  score?: number;
  candidateName?: string;
  examYear?: string;
  rawResponse?: unknown;
  error?: string;
}

/**
 * Verify a JAMB UTME registration number against the JAMB result API.
 * Returns success=false with an error string on any failure so the caller
 * can switch to manual mode without crashing.
 *
 * NOTE: JAMB does not yet expose a public REST API.
 * This client targets the private institutional endpoint available to
 * accredited partners. Configure JAMB_API_URL and JAMB_API_KEY via secrets.
 */
export async function verifyJambResult(params: JambVerifyParams): Promise<JambVerifyResult> {
  if (!params.apiKey) {
    return { success: false, error: 'JAMB_API_KEY not configured — falling back to manual review' };
  }

  try {
    const response = await fetch('https://api.jamb.gov.ng/v1/result/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${params.apiKey}`,
        'X-Client': 'WebWaka-Institutional/0.1.0',
      },
      body: JSON.stringify({ reg_number: params.regNumber }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `JAMB API returned HTTP ${response.status}`,
      };
    }

    const data = await response.json() as {
      status: string;
      data?: {
        score: number;
        candidate_name: string;
        exam_year: string;
      };
    };

    if (data.status !== 'success' || !data.data) {
      return { success: false, error: 'JAMB API: result not found', rawResponse: data };
    }

    return {
      success: true,
      score: data.data.score,
      candidateName: data.data.candidate_name,
      examYear: data.data.exam_year,
      rawResponse: data,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `JAMB API unreachable: ${msg}` };
  }
}

// ─── WAEC ─────────────────────────────────────────────────────────────────────

export interface WaecVerifyParams {
  examNumber: string;
  scratchCardPin: string;
  examYear: string;
  apiKey: string;
}

export interface WaecVerifyResult {
  success: boolean;
  candidateName?: string;
  subjects?: Array<{ subject: string; grade: string }>;
  rawResponse?: unknown;
  error?: string;
}

/**
 * Verify a WAEC result using the exam number, scratch-card PIN, and exam year.
 * Same fallback contract as verifyJambResult — never throws.
 */
export async function verifyWaecResult(params: WaecVerifyParams): Promise<WaecVerifyResult> {
  if (!params.apiKey) {
    return { success: false, error: 'WAEC_API_KEY not configured — falling back to manual review' };
  }

  try {
    const response = await fetch('https://api.waec.org.ng/v1/result/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${params.apiKey}`,
        'X-Client': 'WebWaka-Institutional/0.1.0',
      },
      body: JSON.stringify({
        exam_number: params.examNumber,
        scratch_card_pin: params.scratchCardPin,
        exam_year: params.examYear,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `WAEC API returned HTTP ${response.status}`,
      };
    }

    const data = await response.json() as {
      status: string;
      data?: {
        candidate_name: string;
        results: Array<{ subject: string; grade: string }>;
      };
    };

    if (data.status !== 'success' || !data.data) {
      return { success: false, error: 'WAEC API: result not found', rawResponse: data };
    }

    return {
      success: true,
      candidateName: data.data.candidate_name,
      subjects: data.data.results,
      rawResponse: data,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `WAEC API unreachable: ${msg}` };
  }
}
