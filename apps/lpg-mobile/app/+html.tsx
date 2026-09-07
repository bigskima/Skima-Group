import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="theme-color" content="#ED1C2E" />
        <meta name="description" content="SKIMA LPG customer, driver and station fulfilment." />
        <title>SKIMA LPG</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html { color-scheme: light dark; }
              input:-webkit-autofill,
              input:-webkit-autofill:hover,
              input:-webkit-autofill:focus,
              input:-webkit-autofill:active {
                -webkit-background-clip: text;
                background-clip: text;
                transition: background-color 9999s ease-out 0s;
                box-shadow: inset 0 0 0 1000px transparent;
              }
            `,
          }}
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
