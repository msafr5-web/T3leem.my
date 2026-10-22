/** Uniform response envelope shared by every endpoint (SWET §9). */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data });

export const fail = (code: string, message: string, details?: unknown): ApiFailure => ({
  success: false,
  error: details === undefined ? { code, message } : { code, message, details },
});
