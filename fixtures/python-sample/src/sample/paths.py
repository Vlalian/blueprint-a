"""A path with the separators of the platform it runs on."""

import sys

if sys.platform == "win32":

    def native(path: str) -> str:
        if path.startswith("~"):
            return path
        return path.replace("/", "\\")

else:

    def native(path: str) -> str:
        if path.startswith("~"):
            return path
        return path.replace("\\", "/")
