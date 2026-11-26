"""Example suite for the JUnit reader's tests.

generate.sh runs it with pytest's JUnit output. Some tests fail or are skipped
on purpose, and one fixture fails so that pytest writes an <error>.
"""

import pytest


def test_parse():
    assert int("42") == 42


def test_render():
    assert "<b>draft</b>" == "<b>final</b>"


@pytest.mark.skip(reason="needs a network")
def test_network():
    pass


@pytest.mark.parametrize("value", [3], ids=["@pytest.param"])
def test_param(value):
    assert value % 3 == 0


@pytest.fixture
def database():
    raise ConnectionError("there is no database in the example")


def test_setup(database):
    assert database
