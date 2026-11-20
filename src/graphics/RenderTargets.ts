export interface RenderTargetFormat {
  readonly internalFormat: GLenum;
  readonly format: GLenum;
  readonly type: GLenum;
}

/** Framebuffer with one colour texture and an optional sampleable depth texture. */
export class RenderTarget {
  public framebuffer: WebGLFramebuffer;
  public colorTexture: WebGLTexture;
  public depthTexture: WebGLTexture | null = null;
  public width: number = 0;
  public height: number = 0;

  public constructor(
    private readonly gl: WebGL2RenderingContext,
    public readonly debugName: string,
    private readonly colorFormat: RenderTargetFormat,
    private readonly withDepth: boolean,
  ) {
    const framebuffer: WebGLFramebuffer | null = gl.createFramebuffer();
    const colorTexture: WebGLTexture | null = gl.createTexture();
    if (framebuffer === null || colorTexture === null) {
      throw new Error(`[RenderTarget:${debugName}] failed to allocate framebuffer objects.`);
    }
    this.framebuffer = framebuffer;
    this.colorTexture = colorTexture;
    if (withDepth) {
      const depthTexture: WebGLTexture | null = gl.createTexture();
      if (depthTexture === null) {
        throw new Error(`[RenderTarget:${debugName}] failed to allocate depth texture.`);
      }
      this.depthTexture = depthTexture;
    }
  }

  public resize(width: number, height: number): void {
    const clampedWidth: number = Math.max(1, Math.floor(width));
    const clampedHeight: number = Math.max(1, Math.floor(height));
    if (clampedWidth === this.width && clampedHeight === this.height) {
      return;
    }
    const gl: WebGL2RenderingContext = this.gl;
    this.width = clampedWidth;
    this.height = clampedHeight;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.colorFormat.internalFormat, clampedWidth, clampedHeight, 0, this.colorFormat.format, this.colorFormat.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colorTexture, 0);
    if (this.withDepth && this.depthTexture !== null) {
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, clampedWidth, clampedHeight, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
    }
    const status: GLenum = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[RenderTarget:${this.debugName}] framebuffer incomplete (0x${status.toString(16)}).`);
    }
  }

  public bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  public dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.colorTexture);
    if (this.depthTexture !== null) {
      this.gl.deleteTexture(this.depthTexture);
    }
  }
}

/** Picks RGBA16F when the device can render to float targets, otherwise RGBA8. */
export function selectHdrFormat(gl: WebGL2RenderingContext): RenderTargetFormat {
  const floatRenderable: boolean = gl.getExtension('EXT_color_buffer_float') !== null;
  return floatRenderable
    ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}
