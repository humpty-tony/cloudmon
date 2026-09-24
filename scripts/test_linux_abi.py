import unittest

import check_linux_abi


def symbol(name, version, index="UND"):
    return f"  1: 0000000000000000 0 FUNC GLOBAL DEFAULT {index} {name}@{version} (2)\n"


class LinuxABIChecks(unittest.TestCase):
    def test_ubuntu_2204_boundaries_and_numeric_order(self):
        output = (
            symbol("old", "GLIBC_2.9")
            + symbol("current", "GLIBC_2.35")
            + symbol("cpp_old", "GLIBCXX_3.4.9")
            + symbol("cpp", "GLIBCXX_3.4.30")
            + symbol("abi", "CXXABI_1.3.13")
            + symbol("exported", "GLIBC_2.99", "16")
        )
        maxima, errors = check_linux_abi.check_symbols(output)
        self.assertEqual(maxima, check_linux_abi.LIMITS)
        self.assertEqual(errors, [])

    def test_v020_fmod_regression_and_newer_cpp_abis(self):
        # v0.2.0 linked fmod/fmodf against GLIBC_2.38 on Ubuntu 24.04.
        output = symbol("fmod", "GLIBC_2.38") + symbol("fmodf", "GLIBC_2.38")
        maxima, errors = check_linux_abi.check_symbols(output)
        self.assertEqual(maxima["GLIBC"], "2.38")
        self.assertEqual(errors, ["GLIBC_2.38 exceeds GLIBC_2.35: fmod, fmodf"])
        for family, version in (("GLIBCXX", "3.4.31"), ("CXXABI", "1.3.14")):
            with self.subTest(family=family):
                _, errors = check_linux_abi.check_symbols(
                    symbol("normal", "GLIBC_2.34") + symbol("new", f"{family}_{version}")
                )
                self.assertEqual(len(errors), 1)
                self.assertIn(f"{family}_{version} exceeds", errors[0])

    def test_missing_and_private_versions_fail_closed(self):
        for output in ("", "There are no dynamic symbols in this file.",
                       symbol("exported", "GLIBC_2.35", "16"),
                       symbol("private", "GLIBC_PRIVATE"),
                       symbol("normal", "GLIBC_2.34") + symbol("unknown", "GLIBC_FUTURE")):
            with self.subTest(output=output):
                _, errors = check_linux_abi.check_symbols(output)
                self.assertTrue(errors)


if __name__ == "__main__":
    unittest.main()
