# Kaggle Studio

Run Jupyter notebooks and Python scripts on Kaggle's cloud infrastructure directly from VS Code.

## Setup

### Authentication (Required)

You need valid Kaggle API credentials for all features to work properly. Choose one of the following methods:

#### Method 1: Kaggle API Token File (Recommended)
1. **Generate API Token**: Go to [kaggle.com/settings/account](https://kaggle.com/settings/account) → Scroll to API section → Click "Create New API Token"
2. **Download kaggle.json**: This downloads a `kaggle.json` file containing your credentials
3. **Place credentials file**:

   **On Linux/Mac:**
   ```bash
   mkdir -p ~/.kaggle
   mv ~/Downloads/kaggle.json ~/.kaggle/kaggle.json
   chmod 600 ~/.kaggle/kaggle.json
   ```

   **On Windows (PowerShell):**
   ```powershell
   mkdir $env:USERPROFILE\.kaggle -Force
   move $env:USERPROFILE\Downloads\kaggle.json $env:USERPROFILE\.kaggle\
   ```

   **On Windows (Command Prompt):**
   ```cmd
   mkdir %USERPROFILE%\.kaggle
   move %USERPROFILE%\Downloads\kaggle.json %USERPROFILE%\.kaggle\
   ```

#### Method 2: VS Code Sign In
1. **Get API credentials** from [kaggle.com/settings](https://kaggle.com/settings) → Create New API Token  
2. **Sign in**: Command Palette → `Kaggle: Sign In` → Enter username and API key

**⚠️ Important**: If you experience authentication errors (401 Unauthorized), your API token may be expired. Generate a new token from your Kaggle account settings and update your credentials.

## Commands

### Authentication
- `Kaggle: Sign In` - Authenticate with Kaggle API
- `Kaggle: Sign Out` - Clear stored credentials  
- `Kaggle: Check API Status` - Verify API connection

### Notebook Operations
- `Kaggle: Run Current Notebook` - Push and run notebook on Kaggle
- `Kaggle: Push & Run` - Upload notebook without auto-download
- `Kaggle: Download Outputs` - Download results from last run

### Project Setup
- `Kaggle: Init Project` - Create kaggle.yml and metadata files
- `Kaggle: Link Notebook` - Connect to existing Kaggle notebook
- `Kaggle: Attach Dataset` - Add dataset to project configuration

### Datasets & Competitions  
- `Kaggle: Browse Dataset Files` - View and download dataset files
- `Kaggle: Download Dataset` - Download entire dataset
- `Kaggle: Submit to Competition` - Submit predictions

1. **Initialize project**: `Kaggle: Init Project` (creates `kaggle.yml` and `kernel-metadata.json`)
2. **Open notebook**: Any `.ipynb` file  
3. **Run on Kaggle**: Click 🚀 button or use `Kaggle: Run Current Notebook`
4. **Get results**: Outputs download automatically to `.kaggle-outputs/`

## Tree Views

- **My Notebooks** - Your Kaggle notebooks with download/link options and search by language/type/competition
- **Datasets** - Browse and attach popular datasets with search functionality
- **Competitions** - View entered competitions, featured competitions, and search all categories
- **Runs** - Track notebook execution history

## Configuration

Example `kaggle.yml`:
```yaml
project: my-project
kernel_slug: username/my-project
code_file: notebook.ipynb
accelerator: gpu    # none | gpu | tpu
internet: true
datasets:
  - username/dataset-name
```

## Support

- [GitHub Issues](https://github.com/data-quanta/vscode-kaggle-extension/issues)
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=DataQuanta.vscode-kaggle-run)
