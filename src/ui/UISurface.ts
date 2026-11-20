import { VIRTUAL_RESOLUTION } from '../config/GameConstants';
import { applyBarrelDistortion } from '../graphics/PostProcessPipeline';

export interface VirtualPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Offscreen Canvas 2D layer that every UI module draws into using virtual 1920x1080 coordinates.
 * It is uploaded as a premultiplied texture and composited *inside* the CRT pass so the interface
 * receives the same curvature, aberration and scanlines as the scene.
 */
export class UISurface {
  public readonly canvas: HTMLCanvasElement;
  public readonly context: CanvasRenderingContext2D;
  public readonly texture: WebGLTexture;
  private scale: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private pixelWidth: number = 1;
  private pixelHeight: number = 1;
  private devicePixelRatio: number = 1;
  /** Kept in sync with the CRT curvature so hit-testing follows the barrel distortion. */
  public curvature: number = 0;

  public constructor(private readonly gl: WebGL2RenderingContext) {
    this.canvas = document.createElement('canvas');
    const context: CanvasRenderingContext2D | null = this.canvas.getContext('2d');
    if (context === null) {
      throw new Error('[UISurface] 2D canvas context unavailable.');
    }
    this.context = context;
    const texture: WebGLTexture | null = gl.createTexture();
    if (texture === null) {
      throw new Error('[UISurface] createTexture returned null.');
    }
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Letterboxes the virtual canvas into the output buffer (uniform scale, centred). */
  public resize(pixelWidth: number, pixelHeight: number, devicePixelRatio: number): void {
    this.pixelWidth = Math.max(1, pixelWidth);
    this.pixelHeight = Math.max(1, pixelHeight);
    this.devicePixelRatio = devicePixelRatio;
    this.canvas.width = this.pixelWidth;
    this.canvas.height = this.pixelHeight;
    this.scale = Math.min(this.pixelWidth / VIRTUAL_RESOLUTION.width, this.pixelHeight / VIRTUAL_RESOLUTION.height);
    this.offsetX = (this.pixelWidth - VIRTUAL_RESOLUTION.width * this.scale) / 2;
    this.offsetY = (this.pixelHeight - VIRTUAL_RESOLUTION.height * this.scale) / 2;
  }

  /** Clears the layer and installs the virtual-coordinate transform for this frame. */
  public beginFrame(): CanvasRenderingContext2D {
    const context: CanvasRenderingContext2D = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    context.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.globalAlpha = 1;
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    return context;
  }

  public upload(): void {
    const gl: WebGL2RenderingContext = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /**
   * Converts a canvas-relative CSS pixel position to virtual UI coordinates, passing through the same
   * barrel distortion the CRT shader applies so collision boxes match the curved image on screen.
   */
  public clientToVirtual(clientX: number, clientY: number): VirtualPoint | null {
    if (clientX < 0 || clientY < 0) {
      return null;
    }
    const screenU: number = (clientX * this.devicePixelRatio) / this.pixelWidth;
    const screenV: number = 1 - (clientY * this.devicePixelRatio) / this.pixelHeight;
    const [textureU, textureV] = applyBarrelDistortion(screenU, screenV, this.curvature);
    if (textureU < 0 || textureU > 1 || textureV < 0 || textureV > 1) {
      return null;
    }
    const pixelX: number = textureU * this.pixelWidth;
    const pixelY: number = (1 - textureV) * this.pixelHeight;
    return { x: (pixelX - this.offsetX) / this.scale, y: (pixelY - this.offsetY) / this.scale };
  }

  public dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}
