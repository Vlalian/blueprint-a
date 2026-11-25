"""Letter grades for a score out of 100."""


def grade(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 50:
        return "C"
    return "F"


class Report:
    def grade(self, score: int) -> str:
        return grade(score)
