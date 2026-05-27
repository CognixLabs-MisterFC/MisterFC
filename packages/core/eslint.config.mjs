import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', '.turbo/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
