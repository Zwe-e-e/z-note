# Donations: PayPal and PayLah

Z Note stays free under the MIT license. Donations are optional and unlock no features.
The app and download page share one donation dialog, with **PayPal · USD** and **PayLah! · Singapore (SGD)** options. PayPal offers $1, $3 and $5 USD choices.

## PayLah for Singapore

Choose **PayLah!** to display the project owner's supplied donation QR. The original PNG is embedded in `app/js/util.js` as `paylahQr`, so it also works offline and stays compatible with the existing portable updater. **Save QR image** downloads the original PNG. The image bytes are preserved; the code is not regenerated or altered.

Scan the QR in PayLah and check the recipient and amount there before confirming. The PayPal amount choices do not alter this QR. Z Note does not initiate or confirm a PayLah payment, and no payment SDK or new runtime library is included.

To replace the QR, use the owner's new original PNG and update the embedded data URI. Verify its exact bytes and visually check the Donate dialog before rebuilding the portable packages. Do not substitute a generated QR or change its payment payload.

## PayPal

The current public recipient is [Shwe Ba (@shweba)](https://paypal.me/shweba), with amounts in USD. The $3 link was checked on PayPal's recipient page; no payment was sent. If PayPal requests account verification, the account owner must complete it directly in PayPal before relying on donations being accessible.

### Set up your public link

1. Open [PayPal.Me](https://www.paypal.com/paypalme/) and sign in to your own PayPal account.
2. Create your public PayPal.Me link, or find it in your PayPal account's profile/settings. Choose the handle carefully: PayPal says it cannot be changed after creation.
3. Copy the public link, such as `https://paypal.me/YourHandle`. Do not share a password, API secret, or bank details.
4. At the start of `app/js/util.js`, replace the `paypalMe` value in the `donation` settings with your public link. Choose `USD` or `SGD` for `currency`.
5. Open Donate in both `Z Note.html` and `index.html`. Select each amount and check that PayPal shows your intended recipient, currency and amount. You do not need to send a payment to verify the link.
6. Include the updated source in the next release and rebuild both portable packages. Publish the download page and release together; do not silently replace an already published version.

When `paypalMe` is empty, no PayPal account is connected. Amount choices remain visible, but Continue with PayPal is disabled. Do not publish a placeholder or someone else's PayPal link.

### How payments work

A choice of $3 USD opens `https://paypal.me/YourHandle/3USD`. PayPal hosts the payment page, where the supporter reviews and confirms the payment. Choosing an amount in Z Note does not charge anyone. The app does not collect payment details or receive a payment confirmation, and no PayPal script loads when Z Note starts. Notes and folder settings are not sent with the link.

PayPal supports adding an amount and currency code to a PayPal.Me link. Availability and accepted currencies depend on the account and region. PayPal may charge transaction, international-payment or currency-conversion fees. Review the terms and fees for your own account; these contributions are support for the software, not a claim of charitable tax deductibility.

References: [PayPal.Me help](https://www.paypal.com/sg/cshelp/article/what-is-paypalme-help432), [PayPal fees](https://www.paypal.com/sg/cshelp/article/what-are-the-fees-for-paypal-accounts--help383).
