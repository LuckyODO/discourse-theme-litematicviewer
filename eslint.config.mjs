import DiscourseRecommendedTheme from "@discourse/lint-configs/eslint-theme";

export default [
  { ignores: ["renderer/generated/**"] },
  ...DiscourseRecommendedTheme,
];
