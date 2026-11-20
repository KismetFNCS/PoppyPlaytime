import type { MaterialId, MaterialProfile, TextureSlot } from '../assets/AssetManifest';
import { MATERIAL_IDS, MATERIAL_PROFILES, TEXTURE_SLOT_COLOR_SPACE, TEXTURE_SLOTS } from '../assets/AssetManifest';
import type { BakedSurfaceMaps } from './ProceduralTextures';
import { bakeProceduralSurface } from './ProceduralTextures';

/** GPU-resident material: resolved texture handles plus the scalar parameters from its profile. */
export interface MaterialInstance {
  readonly id: MaterialId;
  readonly profile: MaterialProfile;
  readonly textures: Readonly<Record<TextureSlot, WebGLTexture>>;
  /** Records whether each slot came from an authored file or the procedural fallback. */
  readonly slotOrigins: Readonly<Record<TextureSlot, 'authored' | 'procedural'>>;
}

export interface MaterialLoadProgress {
  readonly loadedCount: number;
  readonly totalCount: number;
  readonly currentMaterialName: string;
}

export class MaterialRegistry {
  private readonly instances: Map<MaterialId, MaterialInstance> = new Map();
  private readonly anisotropyExtension: EXT_texture_filter_anisotropic | null;
  private readonly maximumAnisotropy: number;

  public constructor(private readonly gl: WebGL2RenderingContext) {
    this.anisotropyExtension = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maximumAnisotropy =
      this.anisotropyExtension !== null ? Math.min(8, gl.getParameter(this.anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1;
  }

  public get loadedCount(): number {
    return this.instances.size;
  }

  public static get totalCount(): number {
    return MATERIAL_IDS.length;
  }

  /** Loads every profile, yielding to the browser between materials so the bootloader can animate. */
  public async loadAll(onProgress: (progress: MaterialLoadProgress) => void): Promise<void> {
    for (const materialId of MATERIAL_IDS) {
      const profile: MaterialProfile = MATERIAL_PROFILES[materialId];
      onProgress({ loadedCount: this.instances.size, totalCount: MATERIAL_IDS.length, currentMaterialName: profile.displayName });
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => resolve());
      });
      this.instances.set(materialId, await this.loadMaterial(profile));
    }
    onProgress({ loadedCount: this.instances.size, totalCount: MATERIAL_IDS.length, currentMaterialName: 'complete' });
  }

  public get(materialId: MaterialId): MaterialInstance {
    const instance: MaterialInstance | undefined = this.instances.get(materialId);
    if (instance === undefined) {
      throw new Error(`[MaterialRegistry] material "${materialId}" requested before it was loaded.`);
    }
    return instance;
  }

  private async loadMaterial(profile: MaterialProfile): Promise<MaterialInstance> {
    let bakedMaps: BakedSurfaceMaps | null = null;
    const ensureBaked = (): BakedSurfaceMaps => {
      if (bakedMaps === null) {
        bakedMaps = bakeProceduralSurface(profile.proceduralFallback);
      }
      return bakedMaps;
    };
    const textures: Partial<Record<TextureSlot, WebGLTexture>> = {};
    const slotOrigins: Partial<Record<TextureSlot, 'authored' | 'procedural'>> = {};
    for (const slot of TEXTURE_SLOTS) {
      const uri: string | null = profile.maps[slot].uri;
      let texture: WebGLTexture | null = null;
      if (uri !== null) {
        try {
          texture = await this.loadImageTexture(uri, slot);
          slotOrigins[slot] = 'authored';
        } catch (error: unknown) {
          console.warn(`[MaterialRegistry] ${profile.id}.${slot}: failed to load "${uri}", using procedural fallback.`, error);
        }
      }
      if (texture === null) {
        const baked: BakedSurfaceMaps = ensureBaked();
        texture = this.uploadPixels(baked[slot], baked.resolution, slot);
        slotOrigins[slot] = 'procedural';
      }
      textures[slot] = texture;
    }
    return {
      id: profile.id,
      profile,
      textures: textures as Record<TextureSlot, WebGLTexture>,
      slotOrigins: slotOrigins as Record<TextureSlot, 'authored' | 'procedural'>,
    };
  }

  private createConfiguredTexture(): WebGLTexture {
    const texture: WebGLTexture | null = this.gl.createTexture();
    if (texture === null) {
      throw new Error('[MaterialRegistry] createTexture returned null.');
    }
    return texture;
  }

  private finalizeTexture(): void {
    const gl: WebGL2RenderingContext = this.gl;
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.anisotropyExtension !== null) {
      gl.texParameterf(gl.TEXTURE_2D, this.anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT, this.maximumAnisotropy);
    }
  }

  private internalFormatFor(slot: TextureSlot): GLenum {
    return TEXTURE_SLOT_COLOR_SPACE[slot] === 'srgb' ? this.gl.SRGB8_ALPHA8 : this.gl.RGBA8;
  }

  private uploadPixels(pixels: Uint8Array, resolution: number, slot: TextureSlot): WebGLTexture {
    const gl: WebGL2RenderingContext = this.gl;
    const texture: WebGLTexture = this.createConfiguredTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormatFor(slot), resolution, resolution, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.finalizeTexture();
    return texture;
  }

  private async loadImageTexture(uri: string, slot: TextureSlot): Promise<WebGLTexture> {
    const response: Response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const bitmap: ImageBitmap = await createImageBitmap(await response.blob(), {
      imageOrientation: 'flipY',
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const gl: WebGL2RenderingContext = this.gl;
    const texture: WebGLTexture = this.createConfiguredTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormatFor(slot), gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    bitmap.close();
    this.finalizeTexture();
    return texture;
  }

  public dispose(): void {
    for (const instance of this.instances.values()) {
      for (const slot of TEXTURE_SLOTS) {
        this.gl.deleteTexture(instance.textures[slot]);
      }
    }
    this.instances.clear();
  }
}
