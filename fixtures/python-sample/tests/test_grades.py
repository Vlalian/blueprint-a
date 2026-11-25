from sample.grades import Report, grade


def test_a():
    assert grade(95) == "A"


def test_b():
    assert grade(80) == "B"


def test_c():
    assert grade(60) == "C"


def test_f():
    assert grade(10) == "F"


def test_report_grades_like_grade():
    assert Report().grade(90) == "A"
