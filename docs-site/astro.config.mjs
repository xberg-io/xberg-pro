// @ts-check
import starlight from "@astrojs/starlight";
import { xbergStarlightConfig } from "@xberg-io/docs-theme";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

export default defineConfig({
  site: "https://pro.xberg.io",
  integrations: [
    starlight(
      xbergStarlightConfig({
        title: "Xberg Pro",
        description:
          "Documentation for Xberg Pro and Xberg Enterprise: the self-hosted document extraction platform built on " +
          "the open-source Xberg engine, with queueing, storage, search, access control and scale around it.",
        githubUrl: "https://github.com/xberg-io/xberg-pro",
        editBaseUrl: "https://github.com/xberg-io/xberg-pro/edit/main/docs-site/",
        plugins: [
          starlightLlmsTxt({
            promote: ["index*", "overview/**", "start/**"],
            minify: { collapseCodeBlocks: true },
            details:
              "Xberg Pro is a self-hosted, single-node document extraction platform (one container plus PostgreSQL). " +
              "Xberg Enterprise is the Kubernetes edition for multi-team, horizontally scaled deployments. " +
              "Both run the open-source Xberg engine. Contact: contact@xberg.io",
          }),
        ],
        sidebar: [
          { label: "Home", link: "/" },
          {
            label: "Overview",
            items: [
              { label: "Pro and Enterprise", slug: "overview/tiers" },
              { label: "What Pro replaces", slug: "overview/what-pro-replaces" },
              { label: "Moving between tiers", slug: "overview/moving-between-tiers" },
              { label: "Pricing and licensing", slug: "overview/pricing-and-licensing" },
              { label: "Security and data handling", slug: "overview/security" },
              { label: "Roadmap", slug: "overview/roadmap" },
            ],
          },
          {
            label: "Get Started",
            items: [
              { label: "Pro with Docker Compose", slug: "start/pro-docker" },
              { label: "Pro on Kubernetes", slug: "start/pro-helm" },
              { label: "Enterprise on Kubernetes", slug: "start/enterprise-helm" },
              { label: "SDKs", slug: "start/sdks" },
              { label: "Quickstart", slug: "start/quickstart" },
            ],
          },
          { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
          { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
          { label: "Deploy and Operate", items: [{ autogenerate: { directory: "operate" } }] },
          { label: "Observability", items: [{ autogenerate: { directory: "observability" } }] },
          { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
          {
            label: "More",
            items: [
              { label: "Support", slug: "more/support" },
              { label: "Ecosystem", slug: "more/ecosystem" },
            ],
          },
        ],
      }),
    ),
  ],
});
