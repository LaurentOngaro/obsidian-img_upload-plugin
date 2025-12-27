interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  version: number;
}

interface CloudinarySettings {
  cloud_name: string;
  api_key?: string;
  upload_preset?: string;
  api_secret?: string; // NOTE: api_secret should NOT be used in a frontend plugin
}

export class CloudinaryUploader {
  private settings: CloudinarySettings;

  constructor(settings: CloudinarySettings) {
    this.settings = settings;
  }

  /**
   * Upload a File or Blob to Cloudinary.
   * - If `upload_preset` is provided, an unsigned upload will be attempted.
   * - If `api_secret` is present and `api_key` is provided, a signed upload will be attempted
   *   using the locally stored `api_secret` (DANGEROUS: storing the secret in the plugin has security implications).
   */
  async upload(fileOrBlob: File | Blob, filename?: string): Promise<string> {
    const formData = new FormData();

    // Append file with filename when possible
    if (fileOrBlob instanceof File) {
      formData.append('file', fileOrBlob);
    } else {
      const name = filename || `upload-${Date.now()}.png`;
      formData.append('file', fileOrBlob, name);
    }

    if (this.settings.upload_preset) {
      formData.append('upload_preset', this.settings.upload_preset);
    }

    // If api_secret is present and api_key is provided, perform a client-side signed upload
    if (this.settings.api_secret) {
      if (!this.settings.api_key) {
        throw new Error('Signed uploads require api_key and api_secret');
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await sha1Hex(`timestamp=${timestamp}${this.settings.api_secret}`);
      formData.append('timestamp', String(timestamp));
      formData.append('api_key', this.settings.api_key);
      formData.append('signature', signature);
    } else if (this.settings.api_key) {
      // If not signing, include api_key when provided (optional)
      formData.append('api_key', this.settings.api_key);
    }

    const url = `https://api.cloudinary.com/v1_1/${this.settings.cloud_name}/image/upload`;

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      // Try to parse JSON error message if available
      let bodyText = await response.text();
      try {
        const json = JSON.parse(bodyText);
        const message = json.error?.message || bodyText;
        throw new Error(`Upload failed: ${response.status} ${message}`);
      } catch (e) {
        throw new Error(`Upload failed: ${response.status} ${bodyText}`);
      }
    }

    const data: CloudinaryResponse = await response.json();
    return data.secure_url;
  }

  /**
   * Create an unsigned upload preset for the current Cloudinary account.
   * Requires api_key and api_secret (and allow storing the secret enabled by the user).
   */
  async createUploadPreset(presetName: string): Promise<any> {
    if (!this.settings.api_key || !this.settings.api_secret) {
      throw new Error('API key and secret required to create upload preset');
    }

    const url = `https://api.cloudinary.com/v1_1/${this.settings.cloud_name}/upload_presets`;
    const body = {
      name: presetName,
      unsigned: true,
    } as any;

    // Basic auth header
    let authHeader: string;
    if (typeof btoa !== 'undefined') {
      authHeader = 'Basic ' + btoa(`${this.settings.api_key}:${this.settings.api_secret}`);
    } else {
      // Node/electron fallback
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const b = Buffer.from(`${this.settings.api_key}:${this.settings.api_secret}`);
      authHeader = 'Basic ' + b.toString('base64');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      // Try parse error
      try {
        const json = JSON.parse(text);
        throw new Error(json.error?.message || text);
      } catch (e) {
        throw new Error(`Create preset failed: ${response.status} ${text}`);
      }
    }

    try {
      const json = JSON.parse(text);
      return json;
    } catch (e) {
      throw new Error('Invalid response from create upload preset');
    }
  }
}

async function sha1Hex(input: string): Promise<string> {
  // Prefer WebCrypto where available
  if (typeof crypto !== 'undefined' && (crypto as any).subtle) {
    const enc = new TextEncoder();
    const buf = await (crypto as any).subtle.digest('SHA-1', enc.encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Node fallback via dynamic import
  try {
    const nodeCrypto = await import('crypto');
    return nodeCrypto.createHash('sha1').update(input).digest('hex');
  } catch (e) {
    throw new Error('No SHA-1 implementation available');
  }
}
