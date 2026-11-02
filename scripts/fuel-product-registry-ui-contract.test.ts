const admin = await Deno.readTextFile("apps/admin/src/features/services/FuelAdminWorkspace.tsx");
const customer = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderScreen.tsx");
const orders = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrdersScreen.tsx");
const details = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelOrderDetailsScreen.tsx");
const station = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelStationOperationsScreen.tsx");
const driver = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/FuelDriverJobsScreen.tsx");
const gateway = await Deno.readTextFile("supabase/functions/fuel-runtime/index.ts");

function includes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) throw new Error(`${message}: missing "${fragment}"`);
}
function excludes(source: string, fragment: string, message: string): void {
  if (source.includes(fragment)) throw new Error(`${message}: unexpected "${fragment}"`);
}

Deno.test("Fuel product display names and codes are sourced from the database registry", () => {
  for (const [name, source] of Object.entries({admin,customer,orders,details,station,driver})) {
    excludes(source, 'name: "Petrol"', `${name} does not hardcode Petrol`);
    excludes(source, 'name: "Diesel"', `${name} does not hardcode Diesel`);
    excludes(source, 'name: "Kerosene"', `${name} does not hardcode Kerosene`);
    excludes(source, 'title: "Petrol"', `${name} does not hardcode Petrol title`);
    excludes(source, 'title: "Diesel"', `${name} does not hardcode Diesel title`);
    excludes(source, 'title: "Kerosene"', `${name} does not hardcode Kerosene title`);
  }
  includes(customer, 'firstString(product, ["display_name"])', "customer product selection uses registry display name");
  includes(customer, 'firstString(product, ["short_code"])', "customer product selection uses registry code");
  includes(admin, 'catalogText(record, "display_name")', "admin product cards use registry display name");
  includes(admin, 'catalogText(record, "short_code")', "admin product cards use registry code");
  for (const source of [orders,details,station,driver]) {
    includes(source, '/runtime/fuel/products', "operational workspace loads the product registry");
    includes(source, '["display_name"]', "operational workspace renders the registry display name");
  }
});


Deno.test("Fuel ordering follows the LPG-style progressive four-step customer journey", () => {
  includes(customer, 'const [orderStep, setOrderStep] = useState(1)', "Fuel ordering tracks the active progressive step");
  includes(customer, 'Step {orderStep} of 4', "Fuel ordering shows the customer's position in the journey");
  includes(customer, '{orderStep === 1 ? (', "Fuel and station choices are isolated in the first step");
  includes(customer, '{orderStep === 2 ? (', "Litres and live estimate are isolated in the second step");
  includes(customer, '{orderStep === 3 ? (', "Container selection is isolated in the third step");
  includes(customer, '{orderStep === 4 ? (', "Fulfillment and delivery location are isolated in the fourth step");
  includes(customer, '<AppModal visible={reviewOpen}', "The complete order is reviewed before the secure quote is requested");
  includes(customer, 'createOrder.mutateAsync({', "The visual refactor retains the server-side order and quote request");
  includes(customer, 'payOrder.mutateAsync({', "The visual refactor retains the existing wallet payment flow");
  excludes(customer, 'Card title="Choose your fuel"', "Fuel options must not regress into the old long stacked form");
});

Deno.test("the product registry API exposes display metadata alongside canonical keys", () => {
  includes(gateway, '.select("id,key,short_code,display_name,unit_code,quantity_precision,status,metadata,created_at,updated_at")', "Fuel API returns registry display labels and precision");
});
