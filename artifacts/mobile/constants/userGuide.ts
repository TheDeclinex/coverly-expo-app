export type UserGuideItem = {
  title: string;
  body?: string;
  bullets?: string[];
};

export type UserGuideSection = {
  id: string;
  title: string;
  icon: string;
  summary: string;
  items: UserGuideItem[];
};

export const userGuideReminder =
  "Coverly helps you record and organise your contents information. You should review details for accuracy and keep important supporting evidence where possible.";

export const userGuideSections: UserGuideSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "home",
    summary: "Create your account, add a property, add rooms, then start building your inventory.",
    items: [
      {
        title: "Create your account",
        body: "Sign in or create an account so your inventory can be saved to your Coverly profile.",
      },
      {
        title: "Add your first property",
        body: "A property is the place you want to inventory, such as your main home, a rental property, a holiday home, storage, a parent's home, a business, or another location.",
      },
      {
        title: "Add rooms",
        body: "Rooms help keep items organised. Open a property, add rooms, then add or scan items into the room where they belong.",
      },
      {
        title: "Build your record over time",
        body: "You do not need to complete everything at once. Start with important rooms or higher value items, then return later to fill gaps.",
      },
    ],
  },
  {
    id: "properties-rooms",
    title: "Properties and rooms",
    icon: "grid",
    summary: "Use properties and rooms to keep your contents organised and easier to review.",
    items: [
      {
        title: "Property value and cover",
        body: "Coverly totals item estimates for a property and can compare that inventory value with the contents cover amount you enter.",
      },
      {
        title: "Room summaries",
        body: "Room cards show item counts and value breakdowns so you can spot rooms that need more detail.",
      },
      {
        title: "Photos and covers",
        body: "You can add cover photos for properties and rooms to make your inventory easier to navigate.",
      },
    ],
  },
  {
    id: "adding-items",
    title: "Adding items",
    icon: "plus-square",
    summary: "Add items manually, from scans, or by filling in item detail screens.",
    items: [
      {
        title: "Add manually",
        body: "Use Add manually when you know what you want to record. Add the item name, room, category, quantity, estimated value, photo, and notes where useful.",
      },
      {
        title: "Product and purchase details",
        body: "Item detail screens include fields such as brand or maker, model, condition, purchase source, purchase year, original purchase price, and notes.",
      },
      {
        title: "Quantity and value",
        body: "Quantity helps Coverly calculate the total value for repeated items. Review values after editing quantity or replacement pricing.",
      },
      {
        title: "Review before relying on it",
        body: "AI and price suggestions can speed things up, but you should still check the item name, room, quantity, value, and supporting details.",
      },
    ],
  },
  {
    id: "ai-scanning",
    title: "Scanning with AI",
    icon: "camera",
    summary: "Use photo, multi-photo, video frame, or single item scans to create draft inventory items.",
    items: [
      {
        title: "Single photo scan",
        body: "Take or choose one photo of a room or area. Coverly reviews the image and suggests items it can identify.",
      },
      {
        title: "Multi-photo scan",
        body: "Use multiple photos when one room needs more angles. Coverly reviews the batch together, then shows results for you to check.",
      },
      {
        title: "Video frame scan",
        body: "Record a short room video when it is easier than taking several photos. Coverly uses selected frames to find visible items.",
      },
      {
        title: "Single item scan",
        body: "Use single item scan when you want help identifying one specific item rather than a whole room.",
      },
      {
        title: "Tips for better scans",
        bullets: [
          "Use good lighting.",
          "Avoid blurry photos or fast camera movement.",
          "Scan one room or area at a time.",
          "Keep important items visible and not hidden behind other objects.",
          "Review AI results before saving them.",
        ],
      },
    ],
  },
  {
    id: "replacement-pricing",
    title: "Replacement price search",
    icon: "search",
    summary: "Search for current replacement options and choose the best match for an item.",
    items: [
      {
        title: "Run a search from an item",
        body: "Open an item and use replacement pricing to search for similar products. Adding brand, model, category, and condition can improve the search.",
      },
      {
        title: "Review suggested matches",
        body: "Compare the suggested products and choose the option that best represents what you would reasonably replace the item with.",
      },
      {
        title: "Indicative estimates",
        body: "Replacement prices are estimates and should be reviewed. Prices can change, products can vary, and the best match may not always be the first result.",
      },
    ],
  },
  {
    id: "evidence",
    title: "Receipts and evidence",
    icon: "paperclip",
    summary: "Attach useful supporting documents and photos to important items.",
    items: [
      {
        title: "What you can add",
        body: "Item evidence can include receipts, warranty documents, valuations, extra photos, and other supporting records.",
      },
      {
        title: "What helps later",
        bullets: [
          "Receipts or order confirmations.",
          "Warranty documents.",
          "Serial numbers or model details.",
          "Clear photos of the item.",
          "Valuations for specialist or high value items.",
        ],
      },
      {
        title: "Keep evidence linked",
        body: "Add evidence from the item detail screen so it stays connected to the right inventory item.",
      },
    ],
  },
  {
    id: "claim-packs",
    title: "Claim packs",
    icon: "package",
    summary: "Prepare selected property contents and evidence for a future insurance claim PDF.",
    items: [
      {
        title: "Start from Account",
        body: "Open Account, then Claim packs. Choose a property and continue or create a draft.",
      },
      {
        title: "Select what to include",
        body: "Choose the rooms and items that are relevant. You can review missing details and add items if something has been missed.",
      },
      {
        title: "Generate and open",
        body: "When available for your plan or tester access, Coverly can generate a claim pack PDF and show recent generated packs.",
      },
      {
        title: "Important note",
        body: "Claim packs are designed to help organise insurance documentation. They do not guarantee claim approval.",
      },
    ],
  },
  {
    id: "barcode",
    title: "Barcode lookup",
    icon: "bar-chart-2",
    summary: "Use barcode lookup where available to help identify product details.",
    items: [
      {
        title: "Scan from an item",
        body: "Open an item and use barcode lookup if the product has a barcode. Coverly can apply matching product details when a result is found.",
      },
      {
        title: "If no product is found",
        body: "Some barcodes will not return a result. You can still add or edit the item details manually.",
      },
    ],
  },
  {
    id: "account-plans",
    title: "Account, plans and support",
    icon: "user",
    summary: "Manage your profile, plan access, usage, support, privacy links, and sign out.",
    items: [
      {
        title: "Profile settings",
        body: "Use Profile and preferences to update your name and country settings.",
      },
      {
        title: "Plans and usage",
        body: "Account shows your current plan, plan options, purchase restore controls, and monthly usage for AI scans and replacement price searches where limits apply.",
      },
      {
        title: "Support",
        body: "Use Feedback and support to report an issue or send a suggestion. Include what you were doing, your phone model, and screenshots if possible.",
      },
      {
        title: "Privacy, terms and sign out",
        body: "Account also includes privacy and terms links when configured, plus sign out and account deletion request options.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "help-circle",
    summary: "Quick fixes for common scan, image, pricing, barcode, and account issues.",
    items: [
      {
        title: "AI scan missed or named something incorrectly",
        body: "Edit the result before saving, or save the useful items and add the missing item manually. Better lighting and clearer angles usually help.",
      },
      {
        title: "Replacement price looks wrong",
        body: "Check the item name, brand, model, category, and condition, then search again or choose a better match from the results.",
      },
      {
        title: "Photo or image does not appear",
        body: "Wait a moment, pull to refresh if available, or leave and return to the screen. If it keeps happening, send feedback with the screen and action you took.",
      },
      {
        title: "Barcode not found",
        body: "Try again in good lighting and make sure the barcode is flat and readable. If it still is not found, enter the details manually.",
      },
      {
        title: "Forgot password or app feels stuck",
        body: "Use Forgot password on the login screen. If a screen appears stuck, close and reopen the app, then contact support if the issue continues.",
      },
    ],
  },
];
