# Third-party components and credits

Z Note is released under the [MIT License](LICENSE). This inventory records components identified in the application, build scripts and tests reviewed on 23 November 2026. Third-party components retain their own terms; the project license does not relicense them. This review does not establish the original provenance of every code snippet or asset.

## Included algorithm: Mulberry32

The seeded random generator in `app/js/board.js` uses Mulberry32 to give board strokes a repeatable hand-drawn appearance.

- Algorithm: Tommy Ettinger, 2017. The [original reference implementation](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c) is dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- JavaScript reference: [Bryc's Mulberry32 implementation](https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32), whose document declares its implementations public domain.

These references permit free use, including commercial use. The credit records the algorithm and reference implementations without asserting which source was used during the original development. The portable package also carries this credit in `START HERE.txt`.

## Development tools, not included in the portable package

`tests/awake.browser.cjs` imports **Playwright** for optional browser testing. Playwright is Copyright Microsoft Corporation and uses the [Apache License 2.0](https://github.com/microsoft/playwright/blob/main/LICENSE). Its [NOTICE](https://github.com/microsoft/playwright/blob/main/NOTICE) also credits code derived from Puppeteer. Playwright, its dependencies and its browser downloads are not shipped with Z Note. If a future distribution includes them, retain the applicable licenses and notices for the versions being distributed.

The JavaScript checks use an independently installed **Node.js** runtime and its built-in modules. Node.js is not shipped with Z Note; its own [license and third-party notices](https://github.com/nodejs/node/blob/main/LICENSE) apply to that runtime.

## Installed platform components, not included in the portable package

- **Windows and .NET Framework:** the launcher and helper use the user's installed Windows APIs and .NET Framework assemblies. The build scripts invoke the installed .NET Framework compiler. Z Note does not include Windows DLLs or a .NET Framework installer. These components retain Microsoft's terms; see the [Microsoft .NET Framework deployment guide](https://learn.microsoft.com/en-us/dotnet/framework/deployment/deployment-guide-for-developers).
- **Web browser:** Z Note opens the user's own browser. Chrome, Edge and other browsers are not bundled, and retain their respective licenses.
- **System fonts:** `app/css/theme.css` names fonts that may already be installed, with generic fallbacks. No font files or web-font downloads are included. Listing a font family in CSS does not grant permission to redistribute the font file; its own license applies if it is distributed separately.

## External service

Update checks retrieve public release information and application packages from GitHub. GitHub hosts the public source and download page; no GitHub service code is bundled. Using a service does not make its software part of Z Note's MIT license.

Optional donations open a public PayPal.Me link only after the user chooses to continue with PayPal. PayPal hosts the payment page; no PayPal SDK or payment-processing code is bundled with Z Note. PayPal's account terms and fees apply separately.

The PayLah donation option displays the project owner's supplied QR image, preserved as an embedded PNG. Payments are handled in PayLah, with no PayLah SDK or payment-processing library bundled. PayLah and DBS names and marks belong to their respective owners; their display does not imply endorsement of Z Note.

## Portable license text

`START HERE.txt` includes the full Z Note MIT License and the Mulberry32 credit. Keeping these in an existing package file lets recipients retain the license without adding archive entries that older automatic updaters reject. Keep the full license text when redistributing copies or substantial portions of Z Note.
