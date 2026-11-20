import type { AxisAlignedBounds, MeshData } from './Geometry';
import { computeBounds } from './Geometry';

/** Attribute slots match the `layout(location = N)` qualifiers in SCENE_VERTEX_SHADER. */
export const VERTEX_ATTRIBUTE_SLOTS = {
  position: 0,
  normal: 1,
  uv: 2,
  tangent: 3,
} as const;

/** GPU-resident mesh: one VAO with interleaved-free attribute buffers and a 32-bit index buffer. */
export class GpuMesh {
  public readonly vertexArray: WebGLVertexArrayObject;
  public readonly indexCount: number;
  public readonly bounds: AxisAlignedBounds;
  private readonly buffers: WebGLBuffer[] = [];
  private disposed: boolean = false;

  public constructor(private readonly gl: WebGL2RenderingContext, public readonly debugName: string, meshData: MeshData) {
    const vertexArray: WebGLVertexArrayObject | null = gl.createVertexArray();
    if (vertexArray === null) {
      throw new Error(`[GpuMesh:${debugName}] createVertexArray returned null.`);
    }
    this.vertexArray = vertexArray;
    gl.bindVertexArray(vertexArray);
    this.uploadAttribute(VERTEX_ATTRIBUTE_SLOTS.position, meshData.positions, 3);
    this.uploadAttribute(VERTEX_ATTRIBUTE_SLOTS.normal, meshData.normals, 3);
    this.uploadAttribute(VERTEX_ATTRIBUTE_SLOTS.uv, meshData.uvs, 2);
    this.uploadAttribute(VERTEX_ATTRIBUTE_SLOTS.tangent, meshData.tangents, 4);
    const indexBuffer: WebGLBuffer = this.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = meshData.indices.length;
    this.bounds = computeBounds(meshData);
  }

  private createBuffer(): WebGLBuffer {
    const buffer: WebGLBuffer | null = this.gl.createBuffer();
    if (buffer === null) {
      throw new Error(`[GpuMesh:${this.debugName}] createBuffer returned null.`);
    }
    this.buffers.push(buffer);
    return buffer;
  }

  private uploadAttribute(slot: number, data: Float32Array, componentCount: number): void {
    const buffer: WebGLBuffer = this.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
    this.gl.enableVertexAttribArray(slot);
    this.gl.vertexAttribPointer(slot, componentCount, this.gl.FLOAT, false, 0, 0);
  }

  public draw(): void {
    if (this.disposed) {
      return;
    }
    this.gl.bindVertexArray(this.vertexArray);
    this.gl.drawElements(this.gl.TRIANGLES, this.indexCount, this.gl.UNSIGNED_INT, 0);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.gl.deleteVertexArray(this.vertexArray);
    for (const buffer of this.buffers) {
      this.gl.deleteBuffer(buffer);
    }
    this.buffers.length = 0;
  }
}
