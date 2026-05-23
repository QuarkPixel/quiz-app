declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "$bundled-bank" {
  const questions: import("./src/types").Question[];
  export default questions;
}
