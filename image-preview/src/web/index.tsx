// The web part of Image Preview: the images of a session's file panel, which it shows in place of Gasho's view of them
// (see preview.tsx). It needs Gasho's plugin API 1.18: the file viewers of the file panel.
import { definePlugin } from "@gasho/plugin-sdk";
import { IMAGE_EXTENSIONS } from "./images";
import { ImagePreview } from "./preview";
import "./style.css";

export default definePlugin({
  fileViewers: [{ id: "image", extensions: IMAGE_EXTENSIONS, component: ImagePreview }],
});
