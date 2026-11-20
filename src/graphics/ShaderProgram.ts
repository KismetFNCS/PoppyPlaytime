/** Compiled + linked GLSL ES 3.00 program with a cached uniform-location table. */
export class ShaderProgram {
  public readonly program: WebGLProgram;
  private readonly uniformLocations: Map<string, WebGLUniformLocation | null> = new Map();

  public constructor(
    private readonly gl: WebGL2RenderingContext,
    public readonly debugName: string,
    vertexSource: string,
    fragmentSource: string,
  ) {
    const vertexShader: WebGLShader = ShaderProgram.compile(gl, gl.VERTEX_SHADER, vertexSource, `${debugName}.vert`);
    const fragmentShader: WebGLShader = ShaderProgram.compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${debugName}.frag`);
    const program: WebGLProgram | null = gl.createProgram();
    if (program === null) {
      throw new Error(`[ShaderProgram:${debugName}] gl.createProgram returned null.`);
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      const log: string = gl.getProgramInfoLog(program) ?? 'no info log';
      gl.deleteProgram(program);
      throw new Error(`[ShaderProgram:${debugName}] link failed:\n${log}`);
    }
    this.program = program;
  }

  private static compile(gl: WebGL2RenderingContext, stage: GLenum, source: string, label: string): WebGLShader {
    const shader: WebGLShader | null = gl.createShader(stage);
    if (shader === null) {
      throw new Error(`[ShaderProgram:${label}] gl.createShader returned null.`);
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      const log: string = gl.getShaderInfoLog(shader) ?? 'no info log';
      const numbered: string = source
        .split('\n')
        .map((line: string, index: number) => `${String(index + 1).padStart(4, ' ')}| ${line}`)
        .join('\n');
      gl.deleteShader(shader);
      throw new Error(`[ShaderProgram:${label}] compile failed:\n${log}\n${numbered}`);
    }
    return shader;
  }

  public use(): void {
    this.gl.useProgram(this.program);
  }

  public location(uniformName: string): WebGLUniformLocation | null {
    if (!this.uniformLocations.has(uniformName)) {
      this.uniformLocations.set(uniformName, this.gl.getUniformLocation(this.program, uniformName));
    }
    return this.uniformLocations.get(uniformName) ?? null;
  }

  public setFloat(uniformName: string, value: number): void {
    this.gl.uniform1f(this.location(uniformName), value);
  }

  public setInt(uniformName: string, value: number): void {
    this.gl.uniform1i(this.location(uniformName), value);
  }

  public setVec2(uniformName: string, x: number, y: number): void {
    this.gl.uniform2f(this.location(uniformName), x, y);
  }

  public setVec3(uniformName: string, x: number, y: number, z: number): void {
    this.gl.uniform3f(this.location(uniformName), x, y, z);
  }

  public setVec3Array(uniformName: string, packed: Float32Array): void {
    this.gl.uniform3fv(this.location(uniformName), packed);
  }

  public setFloatArray(uniformName: string, packed: Float32Array): void {
    this.gl.uniform1fv(this.location(uniformName), packed);
  }

  public setMat3(uniformName: string, matrix: Float32Array): void {
    this.gl.uniformMatrix3fv(this.location(uniformName), false, matrix);
  }

  public setMat4(uniformName: string, matrix: Float32Array): void {
    this.gl.uniformMatrix4fv(this.location(uniformName), false, matrix);
  }

  public bindTexture(uniformName: string, textureUnit: number, texture: WebGLTexture): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + textureUnit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.location(uniformName), textureUnit);
  }

  public dispose(): void {
    this.gl.deleteProgram(this.program);
    this.uniformLocations.clear();
  }
}
