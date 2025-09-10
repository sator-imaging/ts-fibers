import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

const input = 'src/index.ts';

export default [
  // ✅ ESM + CJS + UMD
  {
    input,
    output: [
      {
        file: 'dist/index.esm.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        exports: 'named',
        sourcemap: true,
      },
      {
        file: 'dist/index.umd.js',
        format: 'umd',
        name: 'Fibers',
        exports: 'named',
        sourcemap: true,
      }
    ],
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false, // Genereate typedef in other step
      }),
      terser({
        format: {
          comments: false, // Remove comments
        },
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
        },
        mangle: true, // Rename symbols/variables
      }),
    ],
    treeshake: true,
  },

  // ✅ typedef
  {
    input: 'dist/index.d.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es'
    },
    plugins: [dts()]
  }
];
