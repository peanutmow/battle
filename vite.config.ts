import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const cdnBase = "";
  const htmlAssetData = {
    manifestHref: "/manifest.json",
    faviconHref: "/images/Favicon.svg",
    gameplayScreenshotUrl: "/images/GameplayScreenshot.png",
    backgroundImageUrl: "/images/background.webp",
    desktopLogoImageUrl: "/images/OpenFront.png",
    mobileLogoImageUrl: "/images/OF.png",
  };

  return {
    root: "./",
    base: "/",
    publicDir: "resources",

    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      createHtmlPlugin({
        minify: false,
        entry: "/src/client/Main.ts",
        template: "index.html",
        inject: {
          data: {
            gitCommit: JSON.stringify("DEV"),
            assetManifest: JSON.stringify({}),
            cdnBase: JSON.stringify(cdnBase),
            gameEnv: JSON.stringify("dev"),
            numWorkers: JSON.stringify(2),
            turnstileSiteKey: JSON.stringify("1x00000000000000000000AA"),
            jwtAudience: JSON.stringify("localhost"),
            instanceId: JSON.stringify("DEV_ID"),
            ...htmlAssetData,
          },
        },
      }),
      tailwindcss(),
    ],

    define: {
      __ASSET_MANIFEST__: JSON.stringify({}),
    },

    build: {
      outDir: "static",
      emptyOutDir: true,
      assetsDir: "assets",
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            const vendorModules = ["pixi.js", "howler", "zod"];
            if (vendorModules.some((module) => id.includes(module))) {
              return "vendor";
            }
          },
        },
      },
    },

    server: {
      port: 9000,
      host: process.env.VITE_HOST === "lan",
      open: process.env.SKIP_BROWSER_OPEN !== "true",
    },
  };
});
