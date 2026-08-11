"""
Test all Zlibrary APIs and document inputs/outputs.
"""
import json
import sys
from zlibrary_api import Zlibrary

EMAIL = "2624696826@qq.com"
PASSWORD = "023566023566a"

LIB = Zlibrary(EMAIL, PASSWORD)

RESULTS = {}

def safe_call(method, desc, *args, **kwargs):
    """Call a method and capture result/error."""
    try:
        result = method(*args, **kwargs)
        if result is None:
            RESULTS[desc] = {"success": False, "error": "Returned None (likely not logged in)"}
        elif isinstance(result, (int, float)):
            RESULTS[desc] = {"success": True, "type": type(result).__name__, "data": result}
        elif isinstance(result, bytes):
            RESULTS[desc] = {"success": True, "type": "bytes", "data_length": len(result)}
        elif isinstance(result, tuple) and len(result) == 2:
            filename, content = result
            RESULTS[desc] = {"success": True, "type": "tuple(filename, bytes)", "filename": filename, "data_length": len(content)}
        elif isinstance(result, dict):
            RESULTS[desc] = {"success": True, "type": "dict", "data": result}
        else:
            RESULTS[desc] = {"success": True, "type": type(result).__name__, "data": str(result)[:500]}
    except Exception as e:
        RESULTS[desc] = {"success": False, "error": str(e), "error_type": type(e).__name__}


def truncate_dict(d, max_items=5, max_str=200):
    """Truncate large dicts/strings for display."""
    if isinstance(d, dict):
        truncated = {}
        for i, (k, v) in enumerate(d.items()):
            if i >= max_items:
                truncated["...(truncated)"] = f"{len(d)-max_items} more items"
                break
            if isinstance(v, str) and len(v) > max_str:
                truncated[k] = v[:max_str] + "..."
            elif isinstance(v, dict):
                truncated[k] = truncate_dict(v, max_items=5, max_str=150)
            elif isinstance(v, list):
                truncated[k] = f"[list of {len(v)} items]"
            else:
                truncated[k] = v
        return truncated
    return d


def main():
    print(f"Test Zlibrary APIs with account: {EMAIL}")
    print("=" * 80)

    # ---- Portion 1: Login ----
    print("[1] Testing login...")
    if LIB.isLoggedIn():
        print("  -> Login SUCCESS")

    # ---- Portion 2: Profile ----
    print("\n[2] getProfile()")
    safe_call(LIB.getProfile, "getProfile")

    # ---- Portion 3: Most Popular ----
    print("[3] getMostPopular()")
    safe_call(LIB.getMostPopular, "getMostPopular (default)")

    print("[4] getMostPopular(switch_language='zh')")
    safe_call(lambda: LIB.getMostPopular(switch_language="zh"), "getMostPopular (zh)")

    # ---- Portion 4: Recently ----
    print("[5] getRecently()")
    safe_call(LIB.getRecently, "getRecently")

    # ---- Portion 5: User Recommended ----
    print("[6] getUserRecommended()")
    safe_call(LIB.getUserRecommended, "getUserRecommended")

    # ---- Portion 6: User Downloaded ----
    print("[7] getUserDownloaded()")
    safe_call(LIB.getUserDownloaded, "getUserDownloaded (default)")

    print("[8] getUserDownloaded(page=1, limit=3)")
    safe_call(lambda: LIB.getUserDownloaded(page=1, limit=3), "getUserDownloaded (page=1, limit=3)")

    # ---- Portion 7: User Saved ----
    print("[9] getUserSaved()")
    safe_call(LIB.getUserSaved, "getUserSaved (default)")

    print("[10] getUserSaved(page=1, limit=3)")
    safe_call(lambda: LIB.getUserSaved(page=1, limit=3), "getUserSaved (page=1, limit=3)")

    # ---- Portion 8: Extensions ----
    print("[11] getExtensions()")
    safe_call(LIB.getExtensions, "getExtensions")

    # ---- Portion 9: Domains ----
    print("[12] getDomains()")
    safe_call(LIB.getDomains, "getDomains")

    # ---- Portion 10: Languages ----
    print("[13] getLanguages()")
    safe_call(LIB.getLanguages, "getLanguages")

    # ---- Portion 11: Plans ----
    print("[14] getPlans()")
    safe_call(LIB.getPlans, "getPlans (default)")

    print("[15] getPlans(switch_language='zh')")
    safe_call(lambda: LIB.getPlans(switch_language="zh"), "getPlans (zh)")

    # ---- Portion 12: Info ----
    print("[16] getInfo()")
    safe_call(LIB.getInfo, "getInfo (default)")

    print("[17] getInfo(switch_language='zh')")
    safe_call(lambda: LIB.getInfo(switch_language="zh"), "getInfo (zh)")

    # ---- Portion 13: Donations ----
    print("[18] getDonations()")
    safe_call(LIB.getDonations, "getDonations")

    # ---- Portion 14: Downloads Left ----
    print("[19] getDownloadsLeft()")
    safe_call(LIB.getDownloadsLeft, "getDownloadsLeft")

    # ---- Portion 15: Search ----
    print("[20] search(message='python')")
    safe_call(lambda: LIB.search(message="python"), "search (python)")

    print("[21] search(message='python', limit=3)")
    safe_call(lambda: LIB.search(message="python", limit=3), "search (python, limit=3)")

    print("[22] search(message='python', yearFrom=2020, extensions=['pdf'], limit=3)")
    safe_call(
        lambda: LIB.search(message="python", yearFrom=2020, extensions=["pdf"], limit=3),
        "search (python, yearFrom=2020, extensions=pdf, limit=3)"
    )

    # ---- Portion 16: Find a book for book-specific APIs ----
    # Try to get a book from search results
    test_book_id = None
    test_book_hash = None
    search_res = RESULTS.get("search (python, limit=3)", {}).get("data", {})
    if search_res and search_res.get("success", True):
        books = search_res.get("books", [])
        if books:
            test_book_id = books[0].get("id")
            test_book_hash = books[0].get("hash")
            print(f"\n   Found book for testing: id={test_book_id}, hash={test_book_hash}")

    if test_book_id and test_book_hash:
        # ---- Portion 17: Book Info ----
        print("[23] getBookInfo()")
        safe_call(
            lambda: LIB.getBookInfo(test_book_id, test_book_hash),
            f"getBookInfo (id={test_book_id})"
        )

        # ---- Portion 18: Book Formats ----
        print("[24] getBookForamt()")
        safe_call(
            lambda: LIB.getBookForamt(test_book_id, test_book_hash),
            f"getBookForamt (id={test_book_id})"
        )

        # ---- Portion 19: Similar Books ----
        print("[25] getSimilar()")
        safe_call(
            lambda: LIB.getSimilar(test_book_id, test_book_hash),
            f"getSimilar (id={test_book_id})"
        )

        # ---- Portion 20: Save Book ----
        print("[26] saveBook()")
        safe_call(
            lambda: LIB.saveBook(test_book_id),
            f"saveBook (id={test_book_id})"
        )

        # ---- Portion 21: Send To ----
        print("[27] sendTo()")
        safe_call(
            lambda: LIB.sendTo(test_book_id, test_book_hash, "email"),
            f"sendTo (id={test_book_id}, totype=email)"
        )

        # ---- Portion 22: Get Image ----
        print("[28] getImage()")
        book_obj = {"id": test_book_id, "hash": test_book_hash, "cover": ""}
        # Get cover URL from book info
        book_info = RESULTS.get(f"getBookInfo (id={test_book_id})", {}).get("data", {})
        if isinstance(book_info, dict):
            cover_url = book_info.get("cover", "")
            if cover_url:
                book_obj["cover"] = cover_url
                safe_call(lambda: LIB.getImage(book_obj), f"getImage (id={test_book_id})")

        # ---- Portion 23: Download Book (just check response, don't save) ----
        print("[29] downloadBook()")
        safe_call(
            lambda: LIB.downloadBook(book_obj),
            f"downloadBook (id={test_book_id})"
        )

        # ---- Portion 24: Unsave Book (cleanup) ----
        print("[30] unsaveUserBook()")
        safe_call(
            lambda: LIB.unsaveUserBook(test_book_id),
            f"unsaveUserBook (id={test_book_id})"
        )

    # ---- Portion 25: Hide Banner ----
    print("[31] hideBanner()")
    safe_call(LIB.hideBanner, "hideBanner")

    print("\n" + "=" * 80)
    print("ALL API TESTS COMPLETE")
    print("=" * 80)

    # ---- Print Summary ----
    print("\n\nAPI INPUT/OUTPUT DOCUMENTATION")
    print("=" * 80)
    for key, val in RESULTS.items():
        status = "OK" if val.get("success") else "FAIL"
        print(f"\n--- {key} ---  [{status}]")
        if "type" in val:
            print(f"  Return type: {val['type']}")
        if "data" in val:
            d = truncate_dict(val["data"])
            print(f"  Output: {json.dumps(d, indent=2, ensure_ascii=False)[:3000]}")
        if "error" in val and not val.get("success"):
            print(f"  Error: {val['error']}")
        elif "error" in val:
            print(f"  Note: {val['error']}")

    print("\n" + "=" * 80)
    print("SUMMARY TABLE")
    print("=" * 80)
    passed = sum(1 for v in RESULTS.values() if v.get("success"))
    failed = sum(1 for v in RESULTS.values() if not v.get("success"))
    print(f"Total APIs tested: {len(RESULTS)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Success rate: {passed/len(RESULTS)*100:.1f}%")


if __name__ == "__main__":
    main()
