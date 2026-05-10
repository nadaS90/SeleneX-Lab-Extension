# SeleneX Lab

Smart Locator & Selenium Code Generator for Chrome.

SeleneX Lab is a Manifest V3 Chrome side-panel extension that helps testers capture web elements visually, compare strong locator candidates, and generate C# Selenium code for a Nada-style automation framework.



## What It Does

- Select elements directly from any webpage
- Highlights the element before selection
- Captures useful element metadata such as `id`, `name`, `data-*`, ARIA labels, placeholders, text, classes, parent data, and frame path
- Suggests multiple locator options with strength scoring
- Checks whether CSS-based locator candidates are unique on the current page/frame
- Handles iframe and nested-frame selections
- Improves SVG selections by climbing from raw SVG children to a more useful parent target
- Stores recent selections in local history
- Generates C# Selenium helper code
- Copies generated code to the clipboard
- Shows friendly error messages with copyable details

## Generated Code

SeleneX Lab generates C# code designed for an enterprise-style Selenium framework using `By.*` locators and driver helper methods.

Example output:

```csharp
public const string LoginButton = "login-button";

public void ClickLoginButton()
{
    driver.ClickElement(By.Id(LoginButton), "Login Button");
}
```

Supported generated actions:

- Click
- Send Keys
- Select dropdown
- Get Text
- Assert Visible

Generation options include:

- Full Method
- Locator Only
- Use JavaScript Click
- Generate Assert Method
- Include default Send Keys text


## Installation

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the `SeleneX-Lab-Extension` project folder.

Chrome 114 or newer is required because the extension uses the Chrome Side Panel API.

## Usage

1. Open the page you want to inspect.
2. Click the SeleneX Lab extension icon.
3. Click **Select Element** in the side panel.
4. Hover over the target element and click it.
5. Review the locator suggestions.
6. Choose the best locator.
7. Pick the action and output mode.
8. Copy the generated C# Selenium code.

## Locator Strategy

The extension ranks locator candidates by stability and usefulness. It favors clear, maintainable attributes such as stable IDs, names, test attributes, ARIA labels, placeholders, link text, and meaningful CSS selectors. It also flags weaker or more brittle options so testers can avoid random-looking IDs, noisy classes, and fragile selectors.

## Project Structure

```text
SeleneX-Lab-Extension/
├── background.js   # Opens the extension side panel
├── content.js      # Handles page highlighting, element capture, SVG cleanup, and frame detection
├── manifest.json   # Chrome Extension Manifest V3 configuration
├── popup.html      # Side-panel UI and styles
├── popup.js        # Locator ranking, history, uniqueness checks, and C# code generation
└── icons/          # Extension icons
```

## Tech Stack

- Chrome Extension Manifest V3
- Chrome Side Panel API
- HTML
- CSS
- Vanilla JavaScript
- Chrome `scripting`, `storage`, `activeTab`, and `sidePanel` APIs

## Permissions

SeleneX Lab uses:

- `activeTab` to work with the current browser tab
- `scripting` to activate selection and run uniqueness checks
- `storage` to save pending selections and recent history
- `sidePanel` to display the extension UI
- `<all_urls>` host access so element selection can run across tested pages and frames

## Developer

Programmed by **Nada Sayed**

GitHub: https://github.com/nadaS90
