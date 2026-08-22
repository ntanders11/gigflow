import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StageReach",
    short_name: "StageReach",
    description: "CRM for gigging musicians",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0E10",
    theme_color: "#D4A64F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
