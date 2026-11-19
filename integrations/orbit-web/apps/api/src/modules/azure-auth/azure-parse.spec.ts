import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAzAccount, readAzLogin } from "./azure-auth.service.js";

test("the device code and URL are read exactly as az printed them", () => {
  const line = "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code DXT2KQ9LM to authenticate.";
  assert.deepEqual(readAzLogin(`WARNING: ${line}\n`), { url: "https://microsoft.com/devicelogin", code: "DXT2KQ9LM" });
  assert.deepEqual(readAzLogin("nothing yet"), { url: null, code: null });
  assert.deepEqual(readAzLogin("ERROR: AADSTS70000 open the page failed"), { url: null, code: null });
});

test("az account show says who is signed in, to which tenant and subscription", () => {
  const shown = JSON.stringify({ environmentName: "AzureCloud", id: "sub-1", isDefault: true, name: "Contoso Dev", state: "Enabled", tenantId: "tenant-1", user: { name: "dev@contoso.com", type: "user" } });
  assert.deepEqual(parseAzAccount(shown), { user: "dev@contoso.com", userType: "user", tenantId: "tenant-1", subscription: "Contoso Dev", subscriptionId: "sub-1" });
  const tenantOnly = JSON.stringify({ id: "tenant-2", name: "N/A(tenant level account)", tenantId: "tenant-2", user: { name: "dev@contoso.com", type: "user" } });
  assert.equal(parseAzAccount(tenantOnly)?.subscription, "N/A(tenant level account)");
  assert.equal(parseAzAccount("[]"), null);
  assert.equal(parseAzAccount("Please run 'az login'"), null);
});
