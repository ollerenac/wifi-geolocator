# Radio environment snapshot

The Windows setup uses the public Radioconda 2025.03.14 release, matching the
Linux baseline's Python 3.12.9, GNU Radio 3.10.12.0, UHD4.8 and decoder commit.
Read [the Windows guide](../docs/windows-10-setup.md) before installing.

`radioconda-2025.03.14-win-64.lock` is the release's exact Windows package list.
The copied URLs use public channels without upstream authentication path
segments; versions, platform-specific builds and package hash fragments are
unchanged. The JSON alongside records the original/local SHA-256, source URL,
installer checksum and verified Windows decoder artifact layout. No environment
path, laptop profile or credentials are included in the lock.

On Windows, from a conda-enabled prompt at the repository root:

```cmd
conda create -n wifi-geolocator-radio --file environments\radioconda-2025.03.14-win-64.lock
conda activate wifi-geolocator-radio
python check_setup.py
python b210_wifi_collector.py --self-test
```

The GUI installer is an alternative; creating this second environment is
optional. This lock is **win-64 only**, not a Linux environment export.
Firmware images and the physical USB driver still require separate setup.
VOLK profiling is specific to the laptop CPU and remains outside Git.

The Windows package's example path is verified; live USB/RF behavior on
Windows 10 still requires the target laptop's acceptance test. No system
driver, Linux radio installation or native package was changed while preparing
this snapshot.
