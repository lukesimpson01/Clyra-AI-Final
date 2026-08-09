/**
 * Async.com speech-to-text websocket client for OpenCluely.
 * Uses ASYNC_API_KEY / ASYNC_STT_MODEL (same credentials as Clyra voice).
 */
const { EventEmitter } = require('events');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (_) {
  WebSocket = null;
}

const ENDPOINT = 'wss://api.async.com/speech_to_text/stream';

class AsyncSttSession extends EventEmitter {
  constructor({ apiKey, modelId, sampleRate = 16000 } = {}) {
    super();
    this.apiKey = String(apiKey || '').trim();
    this.modelId = modelId || process.env.ASYNC_STT_MODEL || 'async_asr_v1.0';
    this.sampleRate = Number(sampleRate) || 16000;
    this.socket = null;
    this.opening = null;
    this.finalText = '';
    this.closed = false;
  }

  async start() {
    if (!this.apiKey) throw new Error('ASYNC_API_KEY is not configured');
    if (!WebSocket) throw new Error('ws package is required for Async STT');
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.opening) return this.opening;

    this.closed = false;
    this.finalText = '';
    this.opening = new Promise((resolve, reject) => {
      const endpoint = new URL(ENDPOINT);
      endpoint.searchParams.set('api_key', this.apiKey);
      endpoint.searchParams.set('model_id', this.modelId);
      endpoint.searchParams.set('sample_rate', String(this.sampleRate));
      endpoint.searchParams.set('language', 'en');
      const socket = new WebSocket(endpoint.toString());
      this.socket = socket;
      const timeout = setTimeout(() => {
        try {
          socket.terminate();
        } catch (_) {
          /* ignore */
        }
        reject(new Error('Async STT connection timed out'));
      }, 8000);

      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on('message', (raw) => this._handleMessage(String(raw)));
      socket.once('error', (error) => {
        clearTimeout(timeout);
        if (socket.readyState !== WebSocket.OPEN) reject(error);
        else this.emit('error', error.message || String(error));
      });
      socket.once('close', () => {
        clearTimeout(timeout);
        if (this.socket === socket) this.socket = null;
      });
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  _handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.error_code) {
      this.emit('error', message.message || message.error_code);
      return;
    }
    const text = String(message.transcript || message.text || '').trim();
    if (!text) return;
    if (message.final || message.is_final) {
      this.finalText = text;
      this.emit('final', text);
    } else {
      this.emit('partial', text);
    }
  }

  async sendPcm(buffer) {
    await this.start();
    if (!buffer?.length) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), { binary: true });
    }
  }

  async flush() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return this.finalText;
    this.socket.send(JSON.stringify({ final: true }));
    await new Promise((r) => setTimeout(r, 280));
    return this.finalText;
  }

  close() {
    this.closed = true;
    try {
      this.socket?.close();
    } catch (_) {
      /* ignore */
    }
    this.socket = null;
  }
}

module.exports = { AsyncSttSession };
