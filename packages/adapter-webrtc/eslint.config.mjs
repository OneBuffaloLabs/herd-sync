import baseConfig from "@onebuffalo/eslint-config/base";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  }
];
