#!/usr/bin/env perl
use strict;
use warnings;
use JSON::PP;

# flatten_json_keys.pl
# Read a JSON file and print all nested keys in dot notation, one per line.

my $file = shift or die "Usage: $0 <json-file>\n";
open my $fh, '<', $file or die "Can't open $file: $!\n";
local $/;
my $json_text = <$fh>;
close $fh;

my $decoder = JSON::PP->new->relaxed->allow_nonref;
my $data = eval { $decoder->decode($json_text) };
if ($@) { die "Failed to parse JSON in $file: $@\n" }

sub walk {
    my ($node, $prefix) = @_;
    if (ref($node) eq 'HASH') {
        for my $k (sort keys %$node) {
            my $newp = length($prefix) ? "$prefix.$k" : $k;
            walk($node->{$k}, $newp);
        }
    } elsif (ref($node) eq 'ARRAY') {
        # Arrays are not expanded into indices for i18n keys; represent as prefix
        print "$prefix\n" if defined $prefix && $prefix ne '';
    } else {
        print "$prefix\n" if defined $prefix && $prefix ne '';
    }
}

walk($data, '');
exit 0;
